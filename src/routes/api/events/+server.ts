/**
 * F8 — POST /api/events
 *
 * Create a calendar event. Caller is creator (locals.user); couple
 * is derived from locals — never trust client-supplied IDs.
 *
 * Request body: {
 *   title: string;
 *   notes?: string;
 *   startsAt: string (ISO 8601);
 *   endsAt?: string (ISO 8601);
 *   allDay?: boolean;
 * }
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { createEvent, CalendarEventValidationError } from '$lib/server/services/calendar';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('calendar-write', locals.user.id);
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

	try {
		const row = await createEvent({
			coupleId: locals.couple.id,
			createdBy: locals.user.id,
			title: body.title,
			notes: body.notes,
			startsAt: body.startsAt,
			endsAt: body.endsAt,
			allDay: body.allDay
		});
		return json({ ok: true, id: row.id });
	} catch (e) {
		if (e instanceof CalendarEventValidationError) {
			const status = e.code === 'quota_exceeded' ? 429 : 400;
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
