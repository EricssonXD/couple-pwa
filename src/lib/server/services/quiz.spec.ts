// Pure-surface tests for the quiz service. DB-touching paths
// (startOrResumeRun, saveDraft, submitFinal, abandonRun,
// getProjectedRun, listRunsForCouple) are integration-tested against
// a real Postgres in their own harness; this file covers the static
// validators, the public error contract, and the constants.
//
// The race-condition reasoning for submitFinal is documented inline
// in quiz.ts via the `case when other_completed_at is not null then
// now()` SQL — DB tests in the integration layer assert the
// transition is reported once across two concurrent submissions.

import { describe, it, expect } from 'vitest';
import {
	loadCatalog,
	loadQuiz,
	QuizValidationError,
	type QuizPack
} from './quiz';
import {
	MAX_QUESTIONS_PER_PACK,
	MAX_CHOICES_PER_QUESTION,
	MAX_PROMPT_LEN,
	MAX_QUIZ_ID_LEN,
	QUIZ_ID_RE
} from '$lib/quiz.constants';

function fetcherOf(routes: Record<string, unknown>): typeof fetch {
	const f = (url: RequestInfo | URL) => {
		const key = typeof url === 'string' ? url : url.toString();
		const body = routes[key];
		if (body === undefined) {
			return Promise.resolve(new Response('not found', { status: 404 }));
		}
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
	};
	return f as unknown as typeof fetch;
}

function pack(overrides: Partial<QuizPack> = {}): QuizPack {
	return {
		id: 'favorites_v1',
		title: 'Favorites',
		description: 'Coffee or tea?',
		questions: [
			{ id: 'q1', prompt: 'Coffee or tea?', choices: ['Coffee', 'Tea'] },
			{ id: 'q2', prompt: 'Cats or dogs?', choices: ['Cats', 'Dogs', 'Both'] }
		],
		...overrides
	};
}

describe('quiz constants stay in sync with the DB CHECK constraint', () => {
	it('QUIZ_ID_RE mirrors quiz_runs_quiz_id_shape', () => {
		expect(QUIZ_ID_RE.test('favorites_v1')).toBe(true);
		expect(QUIZ_ID_RE.test('a')).toBe(true);
		expect(QUIZ_ID_RE.test('a-b_c-1')).toBe(true);
		// Must start with [a-z0-9].
		expect(QUIZ_ID_RE.test('-leading')).toBe(false);
		expect(QUIZ_ID_RE.test('_leading')).toBe(false);
		// No uppercase.
		expect(QUIZ_ID_RE.test('Foo_v1')).toBe(false);
		// No path separators (defense against traversal).
		expect(QUIZ_ID_RE.test('foo/bar')).toBe(false);
		expect(QUIZ_ID_RE.test('foo.bar')).toBe(false);
		expect(QUIZ_ID_RE.test('../etc/passwd')).toBe(false);
		// Length cap matches MAX_QUIZ_ID_LEN.
		expect(QUIZ_ID_RE.test('a'.repeat(MAX_QUIZ_ID_LEN))).toBe(true);
		expect(QUIZ_ID_RE.test('a'.repeat(MAX_QUIZ_ID_LEN + 1))).toBe(false);
	});

	it('exposes pack-shape limits the validator enforces', () => {
		expect(MAX_QUESTIONS_PER_PACK).toBeGreaterThan(0);
		expect(MAX_CHOICES_PER_QUESTION).toBeGreaterThanOrEqual(2);
		expect(MAX_PROMPT_LEN).toBeGreaterThan(0);
	});
});

describe('QuizValidationError', () => {
	it('preserves a discriminable code', () => {
		const e = new QuizValidationError('x', 'invalid_quiz_id');
		expect(e.code).toBe('invalid_quiz_id');
		expect(e.name).toBe('QuizValidationError');
	});
});

describe('loadCatalog', () => {
	it('parses a valid catalog and drops malformed entries', async () => {
		const f = fetcherOf({
			'/quizzes/index.json': [
				{ id: 'good_v1', title: 'Good', description: 'd', questionCount: 5 },
				{ id: 'BAD_ID', title: 'X', description: 'x', questionCount: 5 },
				{ title: 'no id', description: 'x', questionCount: 5 },
				'not an object'
			]
		});
		const cat = await loadCatalog(f);
		expect(cat).toHaveLength(1);
		expect(cat[0].id).toBe('good_v1');
	});

	it('rejects a non-array catalog', async () => {
		const f = fetcherOf({ '/quizzes/index.json': { not: 'an array' } });
		await expect(loadCatalog(f)).rejects.toBeInstanceOf(QuizValidationError);
	});

	it('surfaces fetch failures as malformed_pack', async () => {
		const f = fetcherOf({}); // /quizzes/index.json -> 404
		await expect(loadCatalog(f)).rejects.toMatchObject({ code: 'malformed_pack' });
	});
});

describe('loadQuiz validation chain', () => {
	const goodCatalog = [
		{ id: 'favorites_v1', title: 'Favorites', description: 'd', questionCount: 2 }
	];

	it('rejects bad-shape quiz ids without fetching', async () => {
		const f = fetcherOf({});
		await expect(loadQuiz('../etc/passwd', f)).rejects.toMatchObject({
			code: 'invalid_quiz_id'
		});
		await expect(loadQuiz('Has_Caps', f)).rejects.toMatchObject({ code: 'invalid_quiz_id' });
	});

	it('rejects ids not in the catalog allowlist', async () => {
		const f = fetcherOf({ '/quizzes/index.json': goodCatalog });
		await expect(loadQuiz('not_in_catalog_v1', f)).rejects.toMatchObject({
			code: 'unknown_quiz_id'
		});
	});

	it('rejects packs whose id does not match the request', async () => {
		const f = fetcherOf({
			'/quizzes/index.json': goodCatalog,
			'/quizzes/favorites_v1.json': { ...pack(), id: 'someone_else_v1' }
		});
		await expect(loadQuiz('favorites_v1', f)).rejects.toMatchObject({
			code: 'malformed_pack'
		});
	});

	it('rejects packs with duplicate question ids', async () => {
		const dup = pack({
			questions: [
				{ id: 'q1', prompt: 'a', choices: ['x', 'y'] },
				{ id: 'q1', prompt: 'b', choices: ['x', 'y'] }
			]
		});
		const f = fetcherOf({
			'/quizzes/index.json': goodCatalog,
			'/quizzes/favorites_v1.json': dup
		});
		await expect(loadQuiz('favorites_v1', f)).rejects.toMatchObject({
			code: 'malformed_pack'
		});
	});

	it('rejects packs with too-long prompts', async () => {
		const big = pack({
			questions: [
				{ id: 'q1', prompt: 'x'.repeat(MAX_PROMPT_LEN + 1), choices: ['a', 'b'] }
			]
		});
		const f = fetcherOf({
			'/quizzes/index.json': goodCatalog,
			'/quizzes/favorites_v1.json': big
		});
		await expect(loadQuiz('favorites_v1', f)).rejects.toMatchObject({
			code: 'malformed_pack'
		});
	});

	it('rejects packs with too few choices', async () => {
		const tooFew = pack({
			questions: [{ id: 'q1', prompt: 'a', choices: ['only one'] }]
		});
		const f = fetcherOf({
			'/quizzes/index.json': goodCatalog,
			'/quizzes/favorites_v1.json': tooFew
		});
		await expect(loadQuiz('favorites_v1', f)).rejects.toMatchObject({
			code: 'malformed_pack'
		});
	});

	it('accepts a well-formed pack', async () => {
		const f = fetcherOf({
			'/quizzes/index.json': goodCatalog,
			'/quizzes/favorites_v1.json': pack()
		});
		const p = await loadQuiz('favorites_v1', f);
		expect(p.id).toBe('favorites_v1');
		expect(p.questions).toHaveLength(2);
	});
});
