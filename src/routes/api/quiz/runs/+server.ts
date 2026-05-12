/**
 * F9 — POST /api/quiz/runs
 *
 * Start (or resume) a Newlywed-Game run for the authenticated user's
 * couple against a given quiz pack. Idempotent on (couple, quiz)
 * thanks to the partial unique index — the same call from either
 * partner returns the same runId until the run completes or is
 * abandoned.
 *
 * Body: { quizId: string }
 * Response: { ok: true, runId, resumed }
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { startOrResumeRun, QuizValidationError } from '$lib/server/services/quiz';

export const POST: RequestHandler = async ({ request, locals }) => {
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

	if (typeof body.quizId !== 'string') {
		return new Response(JSON.stringify({ error: 'malformed', message: 'quizId required' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	try {
		const r = await startOrResumeRun({
			couple: locals.couple,
			viewerId: locals.user.id,
			quizId: body.quizId
		});
		return json({ ok: true, runId: r.runId, resumed: r.resumed });
	} catch (e) {
		if (e instanceof QuizValidationError) {
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status: e.code === 'not_member' ? 403 : 400,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
