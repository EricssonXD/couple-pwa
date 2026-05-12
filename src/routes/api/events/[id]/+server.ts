/**
 * F8 — PATCH/DELETE /api/events/[id]
 *
 * coupleId is derived from locals — service-level WHERE enforces
 * couple membership even though RLS would also block it.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import {
	updateEvent,
	deleteEvent,
	CalendarEventValidationError
} from '$lib/server/services/calendar';

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
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
		const ok = await updateEvent({
			id: params.id!,
			coupleId: locals.couple.id,
			title: body.title,
			notes: body.notes,
			startsAt: body.startsAt,
			endsAt: body.endsAt,
			allDay: body.allDay,
			rrule: body.rrule
		});
		if (!ok) error(404, 'not_found');
		return json({ ok: true });
	} catch (e) {
		if (e instanceof CalendarEventValidationError) {
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const ok = await deleteEvent({ id: params.id!, coupleId: locals.couple.id });
	if (!ok) error(404, 'not_found');
	return json({ ok: true });
};
