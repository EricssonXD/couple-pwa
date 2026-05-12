/**
 * F3 — DELETE /api/scheduled-notes/[id]
 *
 * Cancel an undelivered note. Author-only; the WHERE clause inside
 * cancelNote enforces both ownership and the undelivered guard, so a
 * race against the cron worker resolves cleanly (either the cron wins
 * and the row is delivered → 404; or we win and the row is gone).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelNote } from '$lib/server/services/scheduledNotes';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	const id = params.id;
	if (!id) error(400, 'missing_id');

	const removed = await cancelNote({ id, authorId: locals.user.id });
	if (!removed) error(404, 'not_found_or_already_delivered');
	return json({ ok: true });
};
