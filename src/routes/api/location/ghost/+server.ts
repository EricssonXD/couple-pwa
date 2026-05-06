import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setGhostMode } from '$lib/server/services/location';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');

	let body: { enabled?: boolean; untilMs?: number } = {};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'invalid_json');
	}
	if (typeof body.enabled !== 'boolean') error(400, 'enabled_required');

	await setGhostMode(locals.user.id, body.enabled, body.untilMs);
	return json({ ok: true });
};
