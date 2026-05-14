// DuoSync — F9 "How well do you know me?" quiz service.
//
// Newlywed-Game shape: each partner records BOTH their own truth
// (self_answer) AND a guess about partner (guess_answer) per question.
// Drafts persist (resume across devices). Completion is per-side; the
// global `completed_at` only fires when both sides finalize and is
// set in a single atomic UPDATE so two concurrent submitFinal calls
// race-safely (the second one observes the transition).
//
// All access goes through the service-role Drizzle client. RLS on
// quiz_runs is default-deny (see migration 0017) — the table holds
// asymmetric per-side answers and a direct supabase-js read would
// leak the partner's choices pre-reveal. API handlers MUST derive
// coupleId / viewerId from `locals` and call the projection helper
// when handing a run to the UI.

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { quizRuns } from '$lib/server/db/app.schema';
import { profile } from '$lib/server/db/app.schema';
import { notifyQuizCompleted } from './notifications';
import { awardForEvent } from './pet';
import {
	MAX_CHOICES_PER_QUESTION,
	MAX_PROMPT_LEN,
	MAX_QUESTIONS_PER_PACK,
	QUIZ_ID_RE
} from '$lib/quiz.constants';

export type QuizCatalogEntry = {
	id: string;
	title: string;
	description: string;
	questionCount: number;
};

export type QuizQuestion = {
	id: string;
	prompt: string;
	choices: string[];
};

export type QuizPack = {
	id: string;
	title: string;
	description: string;
	questions: QuizQuestion[];
};

export type SideAnswers = Record<string, number>;

export class QuizValidationError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'invalid_quiz_id'
			| 'unknown_quiz_id'
			| 'malformed_pack'
			| 'malformed_answers'
			| 'not_member'
			| 'run_not_found'
			| 'already_completed'
			| 'already_abandoned'
	) {
		super(message);
		this.name = 'QuizValidationError';
	}
}

// --- Catalog / pack loading --------------------------------------------

function assertCatalog(raw: unknown): QuizCatalogEntry[] {
	if (!Array.isArray(raw)) {
		throw new QuizValidationError('catalog must be an array', 'malformed_pack');
	}
	const out: QuizCatalogEntry[] = [];
	for (const r of raw) {
		if (!r || typeof r !== 'object') continue;
		const e = r as Record<string, unknown>;
		if (
			typeof e.id !== 'string' ||
			!QUIZ_ID_RE.test(e.id) ||
			typeof e.title !== 'string' ||
			typeof e.description !== 'string' ||
			typeof e.questionCount !== 'number'
		) {
			continue;
		}
		out.push({
			id: e.id,
			title: e.title,
			description: e.description,
			questionCount: e.questionCount
		});
	}
	return out;
}

function assertPack(raw: unknown, expectedId: string): QuizPack {
	if (!raw || typeof raw !== 'object') {
		throw new QuizValidationError('pack must be an object', 'malformed_pack');
	}
	const p = raw as Record<string, unknown>;
	if (p.id !== expectedId) {
		throw new QuizValidationError('pack id does not match request', 'malformed_pack');
	}
	if (
		typeof p.title !== 'string' ||
		typeof p.description !== 'string' ||
		!Array.isArray(p.questions)
	) {
		throw new QuizValidationError('pack missing required fields', 'malformed_pack');
	}
	if (p.questions.length === 0 || p.questions.length > MAX_QUESTIONS_PER_PACK) {
		throw new QuizValidationError('pack question count out of range', 'malformed_pack');
	}
	const seen = new Set<string>();
	const questions: QuizQuestion[] = [];
	for (const q of p.questions) {
		if (!q || typeof q !== 'object') {
			throw new QuizValidationError('question must be an object', 'malformed_pack');
		}
		const qq = q as Record<string, unknown>;
		if (
			typeof qq.id !== 'string' ||
			qq.id.length === 0 ||
			typeof qq.prompt !== 'string' ||
			qq.prompt.length === 0 ||
			qq.prompt.length > MAX_PROMPT_LEN ||
			!Array.isArray(qq.choices) ||
			qq.choices.length < 2 ||
			qq.choices.length > MAX_CHOICES_PER_QUESTION ||
			!qq.choices.every((c) => typeof c === 'string' && c.length > 0)
		) {
			throw new QuizValidationError('question shape invalid', 'malformed_pack');
		}
		if (seen.has(qq.id)) {
			throw new QuizValidationError('duplicate question id in pack', 'malformed_pack');
		}
		seen.add(qq.id);
		questions.push({ id: qq.id, prompt: qq.prompt, choices: qq.choices as string[] });
	}
	return { id: expectedId, title: p.title, description: p.description, questions };
}

/** Load and validate the catalog. Caller passes `event.fetch`. */
export async function loadCatalog(
	fetcher: typeof fetch = globalThis.fetch
): Promise<QuizCatalogEntry[]> {
	const res = await fetcher('/quizzes/index.json');
	if (!res.ok) {
		throw new QuizValidationError('catalog fetch failed', 'malformed_pack');
	}
	return assertCatalog(await res.json());
}

/**
 * Load a single pack by id. Defense in depth: regex, allowlist against
 * catalog, encodeURIComponent on the URL.
 */
export async function loadQuiz(
	quizId: string,
	fetcher: typeof fetch = globalThis.fetch
): Promise<QuizPack> {
	if (!QUIZ_ID_RE.test(quizId)) {
		throw new QuizValidationError('quiz id has invalid shape', 'invalid_quiz_id');
	}
	const catalog = await loadCatalog(fetcher);
	if (!catalog.some((c) => c.id === quizId)) {
		throw new QuizValidationError('quiz id not in catalog', 'unknown_quiz_id');
	}
	const res = await fetcher(`/quizzes/${encodeURIComponent(quizId)}.json`);
	if (!res.ok) {
		throw new QuizValidationError('pack fetch failed', 'malformed_pack');
	}
	return assertPack(await res.json(), quizId);
}

// --- Answer validation -------------------------------------------------

function validateAnswers(answers: unknown, pack: QuizPack, allowEmpty: boolean): SideAnswers {
	if (answers === undefined || answers === null) {
		if (allowEmpty) return {};
		throw new QuizValidationError('answers missing', 'malformed_answers');
	}
	if (typeof answers !== 'object' || Array.isArray(answers)) {
		throw new QuizValidationError('answers must be an object', 'malformed_answers');
	}
	const out: SideAnswers = {};
	const byId = new Map(pack.questions.map((q) => [q.id, q]));
	for (const [k, v] of Object.entries(answers as Record<string, unknown>)) {
		const q = byId.get(k);
		if (!q) {
			throw new QuizValidationError('answer references unknown question', 'malformed_answers');
		}
		if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= q.choices.length) {
			throw new QuizValidationError('choice index out of range', 'malformed_answers');
		}
		out[k] = v;
	}
	return out;
}

function isComplete(pack: QuizPack, self: SideAnswers, guess: SideAnswers): boolean {
	for (const q of pack.questions) {
		if (typeof self[q.id] !== 'number' || typeof guess[q.id] !== 'number') return false;
	}
	return true;
}

// --- Run lifecycle -----------------------------------------------------

type CoupleMembers = {
	id: string;
	partnerA: string;
	partnerB: string;
};

function viewerSide(c: CoupleMembers, viewerId: string): 'a' | 'b' {
	if (viewerId === c.partnerA) return 'a';
	if (viewerId === c.partnerB) return 'b';
	throw new QuizValidationError('viewer is not a couple member', 'not_member');
}

export async function startOrResumeRun(input: {
	couple: CoupleMembers;
	viewerId: string;
	quizId: string;
}): Promise<{ runId: string; resumed: boolean }> {
	if (!QUIZ_ID_RE.test(input.quizId)) {
		throw new QuizValidationError('quiz id has invalid shape', 'invalid_quiz_id');
	}
	viewerSide(input.couple, input.viewerId);

	// Try to insert a fresh open run. The partial unique index on
	// (couple_id, quiz_id) WHERE completed_at IS NULL AND abandoned_at
	// IS NULL ensures at most one open run per (couple, pack); a
	// concurrent insert collapses to onConflictDoNothing and we then
	// SELECT the existing row.
	const inserted = await db
		.insert(quizRuns)
		.values({
			coupleId: input.couple.id,
			quizId: input.quizId,
			startedBy: input.viewerId,
			aUserId: input.couple.partnerA,
			bUserId: input.couple.partnerB
		})
		.onConflictDoNothing({
			target: [quizRuns.coupleId, quizRuns.quizId],
			where: sql`${quizRuns.completedAt} is null and ${quizRuns.abandonedAt} is null`
		})
		.returning({ id: quizRuns.id });

	if (inserted.length > 0) {
		return { runId: inserted[0].id, resumed: false };
	}

	const [existing] = await db
		.select({ id: quizRuns.id })
		.from(quizRuns)
		.where(
			and(
				eq(quizRuns.coupleId, input.couple.id),
				eq(quizRuns.quizId, input.quizId),
				isNull(quizRuns.completedAt),
				isNull(quizRuns.abandonedAt)
			)
		)
		.limit(1);
	if (!existing) {
		// Race: open run vanished between insert + select (e.g. abandon).
		// Recurse once.
		return startOrResumeRun(input);
	}
	return { runId: existing.id, resumed: true };
}

async function loadRun(runId: string, coupleId: string) {
	const [r] = await db
		.select()
		.from(quizRuns)
		.where(and(eq(quizRuns.id, runId), eq(quizRuns.coupleId, coupleId)))
		.limit(1);
	if (!r) throw new QuizValidationError('run not found', 'run_not_found');
	return r;
}

/**
 * Save partial answers. Allowed only while the viewer hasn't yet
 * locked in (a/b_completed_at IS NULL on their side).
 */
export async function saveDraft(input: {
	runId: string;
	coupleId: string;
	viewerId: string;
	selfAnswers: unknown;
	guessAnswers: unknown;
	pack: QuizPack;
}): Promise<void> {
	const run = await loadRun(input.runId, input.coupleId);
	if (run.abandonedAt) throw new QuizValidationError('run abandoned', 'already_abandoned');
	if (run.completedAt) throw new QuizValidationError('run completed', 'already_completed');

	const side = viewerSide(
		{ id: input.coupleId, partnerA: run.aUserId, partnerB: run.bUserId },
		input.viewerId
	);
	const sideCompleted = side === 'a' ? run.aCompletedAt : run.bCompletedAt;
	if (sideCompleted) throw new QuizValidationError('side already finalized', 'already_completed');

	const self = validateAnswers(input.selfAnswers, input.pack, true);
	const guess = validateAnswers(input.guessAnswers, input.pack, true);

	const patch =
		side === 'a'
			? { aSelfAnswers: self, aGuessAnswers: guess }
			: { bSelfAnswers: self, bGuessAnswers: guess };
	await db
		.update(quizRuns)
		.set(patch)
		.where(and(eq(quizRuns.id, input.runId), eq(quizRuns.coupleId, input.coupleId)));
}

export type FinalizeResult =
	| { ok: true; bothComplete: false }
	| {
			ok: true;
			bothComplete: true;
			justTransitioned: boolean;
			waitingPartnerId: string | null;
	  };

/**
 * Finalize the viewer's side. Requires both selfAnswers and guessAnswers
 * to cover every question. The completed_at transition is atomic:
 * `completed_at = CASE WHEN <other side already done> THEN now() ELSE NULL`.
 * Returns whether THIS call drove the run from open → both-complete so the
 * caller can fire the push exactly once even under concurrent submit races.
 */
export async function submitFinal(input: {
	runId: string;
	coupleId: string;
	viewerId: string;
	selfAnswers: unknown;
	guessAnswers: unknown;
	pack: QuizPack;
}): Promise<FinalizeResult> {
	const run = await loadRun(input.runId, input.coupleId);
	if (run.abandonedAt) throw new QuizValidationError('run abandoned', 'already_abandoned');
	if (run.completedAt) throw new QuizValidationError('run completed', 'already_completed');

	const side = viewerSide(
		{ id: input.coupleId, partnerA: run.aUserId, partnerB: run.bUserId },
		input.viewerId
	);
	const sideCompletedAlready = side === 'a' ? run.aCompletedAt : run.bCompletedAt;
	if (sideCompletedAlready) {
		throw new QuizValidationError('side already finalized', 'already_completed');
	}

	const self = validateAnswers(input.selfAnswers, input.pack, false);
	const guess = validateAnswers(input.guessAnswers, input.pack, false);
	if (!isComplete(input.pack, self, guess)) {
		throw new QuizValidationError(
			'must answer self + guess for every question',
			'malformed_answers'
		);
	}

	const otherCompletedAt = side === 'a' ? quizRuns.bCompletedAt : quizRuns.aCompletedAt;
	const patch =
		side === 'a'
			? {
					aSelfAnswers: self,
					aGuessAnswers: guess,
					aCompletedAt: sql`now()`,
					completedAt: sql<Date | null>`case when ${otherCompletedAt} is not null then now() else null end`
				}
			: {
					bSelfAnswers: self,
					bGuessAnswers: guess,
					bCompletedAt: sql`now()`,
					completedAt: sql<Date | null>`case when ${otherCompletedAt} is not null then now() else null end`
				};

	const [updated] = await db
		.update(quizRuns)
		.set(patch)
		.where(
			and(
				eq(quizRuns.id, input.runId),
				eq(quizRuns.coupleId, input.coupleId),
				// Defense against race re-entry: skip if already completed.
				isNull(quizRuns.completedAt),
				isNull(quizRuns.abandonedAt)
			)
		)
		.returning({
			completedAt: quizRuns.completedAt,
			aUserId: quizRuns.aUserId,
			bUserId: quizRuns.bUserId
		});

	if (!updated) {
		// Lost a race; treat as already completed.
		throw new QuizValidationError('run completed by another submission', 'already_completed');
	}

	if (!updated.completedAt) {
		return { ok: true, bothComplete: false };
	}

	// We just flipped to complete. Push the partner who was waiting —
	// that's the OTHER side. Notification trigger handles dedupe.
	const waitingPartnerId = side === 'a' ? updated.bUserId : updated.aUserId;
	const justTransitioned = true;

	try {
		const [author] = await db
			.select({ displayName: profile.displayName })
			.from(profile)
			.where(eq(profile.userId, input.viewerId))
			.limit(1);
		await notifyQuizCompleted({
			coupleId: input.coupleId,
			recipientId: waitingPartnerId,
			runId: input.runId,
			quizTitle: input.pack.title,
			finisherDisplayName: author?.displayName ?? null
		});
	} catch (e) {
		console.error('notifyQuizCompleted failed', e);
	}

	// Pet earn (P2.2): mutual full pay, dedupe per run so a re-fire
	// (race re-entry already guarded above) is also a no-op at the
	// pet ledger level.
	await awardForEvent({
		coupleId: input.coupleId,
		userId: input.viewerId,
		source: 'quiz_complete',
		dedupeKey: `quiz_complete:${input.runId}`,
		mutual: true
	});

	return { ok: true, bothComplete: true, justTransitioned, waitingPartnerId };
}

export async function abandonRun(input: {
	runId: string;
	coupleId: string;
	viewerId: string;
}): Promise<boolean> {
	const result = await db
		.update(quizRuns)
		.set({ abandonedAt: sql`now()` })
		.where(
			and(
				eq(quizRuns.id, input.runId),
				eq(quizRuns.coupleId, input.coupleId),
				isNull(quizRuns.completedAt),
				isNull(quizRuns.abandonedAt),
				or(eq(quizRuns.aUserId, input.viewerId), eq(quizRuns.bUserId, input.viewerId))
			)
		)
		.returning({ id: quizRuns.id });
	return result.length > 0;
}

// --- Read projections (anti-coercion / H5) -----------------------------

export type ProjectedRun = {
	id: string;
	quizId: string;
	createdAt: string;
	updatedAt: string;
	abandonedAt: string | null;
	// Viewer's own progress, always exposed.
	viewer: {
		side: 'a' | 'b';
		selfAnswers: SideAnswers;
		guessAnswers: SideAnswers;
		completedAt: string | null;
	};
	// Partner state — masked until reveal. We expose only "they finished" /
	// "still in progress" — never their answers, never timestamps mid-run,
	// never per-question progress. Once both complete, the reveal block is
	// populated.
	partner: {
		hasFinalized: boolean;
	};
	reveal: null | {
		completedAt: string;
		partnerSide: 'a' | 'b';
		viewerSelfAnswers: SideAnswers;
		viewerGuessAnswers: SideAnswers;
		partnerSelfAnswers: SideAnswers;
		partnerGuessAnswers: SideAnswers;
		viewerScore: number;
		partnerScore: number;
		questionCount: number;
	};
};

function score(guesses: SideAnswers, truths: SideAnswers): number {
	let n = 0;
	for (const [qid, g] of Object.entries(guesses)) {
		if (truths[qid] === g) n++;
	}
	return n;
}

export async function getProjectedRun(input: {
	runId: string;
	coupleId: string;
	viewerId: string;
}): Promise<ProjectedRun> {
	const run = await loadRun(input.runId, input.coupleId);
	const side = viewerSide(
		{ id: input.coupleId, partnerA: run.aUserId, partnerB: run.bUserId },
		input.viewerId
	);
	const viewerSelf = (side === 'a' ? run.aSelfAnswers : run.bSelfAnswers) ?? {};
	const viewerGuess = (side === 'a' ? run.aGuessAnswers : run.bGuessAnswers) ?? {};
	const viewerCompletedAt = side === 'a' ? run.aCompletedAt : run.bCompletedAt;
	const partnerCompletedAt = side === 'a' ? run.bCompletedAt : run.aCompletedAt;

	const out: ProjectedRun = {
		id: run.id,
		quizId: run.quizId,
		createdAt: run.createdAt.toISOString(),
		updatedAt: run.updatedAt.toISOString(),
		abandonedAt: run.abandonedAt ? run.abandonedAt.toISOString() : null,
		viewer: {
			side,
			selfAnswers: viewerSelf,
			guessAnswers: viewerGuess,
			completedAt: viewerCompletedAt ? viewerCompletedAt.toISOString() : null
		},
		partner: { hasFinalized: !!partnerCompletedAt },
		reveal: null
	};

	if (run.completedAt) {
		const partnerSelf = (side === 'a' ? run.bSelfAnswers : run.aSelfAnswers) ?? {};
		const partnerGuess = (side === 'a' ? run.bGuessAnswers : run.aGuessAnswers) ?? {};
		out.reveal = {
			completedAt: run.completedAt.toISOString(),
			partnerSide: side === 'a' ? 'b' : 'a',
			viewerSelfAnswers: viewerSelf,
			viewerGuessAnswers: viewerGuess,
			partnerSelfAnswers: partnerSelf,
			partnerGuessAnswers: partnerGuess,
			viewerScore: score(viewerGuess, partnerSelf),
			partnerScore: score(partnerGuess, viewerSelf),
			questionCount: Object.keys(partnerSelf).length
		};
	}
	return out;
}

export type RunSummary = {
	id: string;
	quizId: string;
	state: 'open' | 'completed' | 'abandoned';
	createdAt: string;
	completedAt: string | null;
	viewerSubmitted: boolean;
};

export async function listRunsForCouple(input: {
	coupleId: string;
	viewerId: string;
}): Promise<RunSummary[]> {
	const rows = await db
		.select({
			id: quizRuns.id,
			quizId: quizRuns.quizId,
			aUserId: quizRuns.aUserId,
			bUserId: quizRuns.bUserId,
			aCompletedAt: quizRuns.aCompletedAt,
			bCompletedAt: quizRuns.bCompletedAt,
			completedAt: quizRuns.completedAt,
			abandonedAt: quizRuns.abandonedAt,
			createdAt: quizRuns.createdAt
		})
		.from(quizRuns)
		.where(eq(quizRuns.coupleId, input.coupleId))
		.orderBy(sql`${quizRuns.completedAt} desc nulls first`, desc(quizRuns.createdAt))
		.limit(50);
	return rows.map((r) => {
		const side = viewerSide(
			{ id: input.coupleId, partnerA: r.aUserId, partnerB: r.bUserId },
			input.viewerId
		);
		const viewerCompleted = !!(side === 'a' ? r.aCompletedAt : r.bCompletedAt);
		const state: RunSummary['state'] = r.abandonedAt
			? 'abandoned'
			: r.completedAt
				? 'completed'
				: 'open';
		return {
			id: r.id,
			quizId: r.quizId,
			state,
			createdAt: r.createdAt.toISOString(),
			completedAt: r.completedAt ? r.completedAt.toISOString() : null,
			viewerSubmitted: viewerCompleted
		};
	});
}
