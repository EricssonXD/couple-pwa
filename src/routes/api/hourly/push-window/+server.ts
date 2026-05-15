// F11 — GET / PUT /api/hourly/push-window
//
// Manages the per-user waking window for hourly reminder push
// notifications. Defaults to 9-22 UTC if the user has never set one.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HourlyError, getPushWindow, setPushWindow } from '$lib/server/services/hourly';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	const window = await getPushWindow(locals.user.id);
	return json(window);
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'invalid_json');
	}
	const startHour = Number(body.startHour);
	const endHour = Number(body.endHour);
	const tz = typeof body.tz === 'string' ? body.tz : 'UTC';

	try {
		const saved = await setPushWindow({
			userId: locals.user.id,
			startHour,
			endHour,
			tz
		});
		return json(saved);
	} catch (e) {
		if (e instanceof HourlyError) error(400, e.code);
		throw e;
	}
};
