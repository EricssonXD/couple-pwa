/**
 * F9 — PATCH /api/quiz/runs/[runId]   (save draft OR submit final)
 *      DELETE /api/quiz/runs/[runId]  (abandon)
 *
 * PATCH body:
 *   { kind: 'draft', selfAnswers: {[qid]: int}, guessAnswers: {[qid]: int} }
 *   { kind: 'final', selfAnswers: {[qid]: int}, guessAnswers: {[qid]: int} }
 *
 * Response: GET-shaped projected run (so the client can re-render
 * without an extra round trip).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import {
	abandonRun,
	getProjectedRun,
	loadQuiz,
	QuizValidationError,
	saveDraft,
	submitFinal
} from '$lib/server/services/quiz';

function quizErrorStatus(code: QuizValidationError['code']): number {
	switch (code) {
		case 'not_member':
			return 403;
		case 'run_not_found':
			return 404;
		case 'already_completed':
		case 'already_abandoned':
			return 409;
		default:
			return 400;
	}
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	try {
		const projected = await getProjectedRun({
			runId: params.runId!,
			coupleId: locals.couple.id,
			viewerId: locals.user.id
		});
		return json({ ok: true, run: projected });
	} catch (e) {
		if (e instanceof QuizValidationError) {
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status: quizErrorStatus(e.code),
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};

export const PATCH: RequestHandler = async ({ fetch, params, request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('quiz-write', locals.user.id);
	if (!limit.allowed) {
		return new Response(JSON.stringify({ error: 'rate_limited' }), {
			status: 429,
			headers: {
				'content-type': 'application/json',
				'retry-after': String(Math.ceil(limit.retryAfterMs / 1000))
			}
		});
	}

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'invalid_json');
	}

	const kind = body.kind;
	if (kind !== 'draft' && kind !== 'final') {
		return new Response(
			JSON.stringify({ error: 'malformed', message: "kind must be 'draft' or 'final'" }),
			{
				status: 400,
				headers: { 'content-type': 'application/json' }
			}
		);
	}

	try {
		// Look up the run first to discover which pack to load (we need
		// the pack to validate answer choice indices). loadRun is private
		// but getProjectedRun already does the membership check and gives
		// us quizId.
		const projected = await getProjectedRun({
			runId: params.runId!,
			coupleId: locals.couple.id,
			viewerId: locals.user.id
		});
		const pack = await loadQuiz(projected.quizId, fetch);
		if (kind === 'draft') {
			await saveDraft({
				runId: params.runId!,
				coupleId: locals.couple.id,
				viewerId: locals.user.id,
				selfAnswers: body.selfAnswers,
				guessAnswers: body.guessAnswers,
				pack
			});
		} else {
			await submitFinal({
				runId: params.runId!,
				coupleId: locals.couple.id,
				viewerId: locals.user.id,
				selfAnswers: body.selfAnswers,
				guessAnswers: body.guessAnswers,
				pack
			});
		}
		const fresh = await getProjectedRun({
			runId: params.runId!,
			coupleId: locals.couple.id,
			viewerId: locals.user.id
		});
		return json({ ok: true, run: fresh });
	} catch (e) {
		if (e instanceof QuizValidationError) {
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status: quizErrorStatus(e.code),
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	try {
		const ok = await abandonRun({
			runId: params.runId!,
			coupleId: locals.couple.id,
			viewerId: locals.user.id
		});
		if (!ok) error(404, 'not_found_or_terminal');
		return json({ ok: true });
	} catch (e) {
		if (e instanceof QuizValidationError) {
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status: quizErrorStatus(e.code),
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
