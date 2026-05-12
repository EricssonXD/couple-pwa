/**
 * F16 — /api/repair
 *
 * GET  → { active: RepairSession | null, history: RepairSession[] }
 * POST → start a new repair session for the authenticated user's couple.
 *
 * Body for POST: { cooldownMs?: number; initiatorNote?: string; ephemeral?: boolean }
 *
 * Errors map RepairValidationError.code → HTTP:
 *   note_too_long | cooldown_out_of_range → 400
 *   already_active                         → 409
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import {
	getActiveSession,
	listHistory,
	startSession,
	RepairValidationError
} from '$lib/server/services/repair';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	const [active, history] = await Promise.all([
		getActiveSession(locals.couple.id),
		listHistory(locals.couple.id, 25)
	]);
	return json({ active, history });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('repair-write', locals.user.id);
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
		// Empty body is allowed (use all defaults).
	}

	try {
		const row = await startSession({
			coupleId: locals.couple.id,
			initiatorId: locals.user.id,
			cooldownMs: typeof body.cooldownMs === 'number' ? body.cooldownMs : undefined,
			initiatorNote: typeof body.initiatorNote === 'string' ? body.initiatorNote : undefined,
			ephemeral: body.ephemeral === true
		});
		return json({ ok: true, session: row });
	} catch (e) {
		if (e instanceof RepairValidationError) {
			const status = e.code === 'already_active' ? 409 : 400;
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
