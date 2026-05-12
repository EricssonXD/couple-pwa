// PWA widget data endpoint — returns the JSON payload Adaptive Cards
// hydrates `static/widgets/days-together.template.json` against. The
// `data` shape is keyed to the `${...}` placeholders in that file.
//
// Auth: cookie-based via locals.user (same as the rest of the app).
// Widgets that try to fetch this without a session get a 401, which
// the host renders as an "open app to sign in" placeholder.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { couple } from '$lib/server/db/app.schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(404, 'no_couple');

	const [row] = await db
		.select({ anniversary: couple.anniversary, createdAt: couple.createdAt })
		.from(couple)
		.where(eq(couple.id, locals.couple.id))
		.limit(1);
	if (!row) error(404, 'no_couple');

	const startStr = row.anniversary ?? row.createdAt;
	const start = new Date(startStr as unknown as string);
	const days = Math.max(0, Math.floor((Date.now() - start.getTime()) / 86_400_000));

	return json(
		{
			title: 'Together for',
			days: String(days),
			subtitle: days === 1 ? 'day' : 'days',
			openUrl: `${url.origin}/timeline`
		},
		{
			headers: {
				// Hosts may cache; the manifest declares update=3600 so
				// keep this at most that long.
				'cache-control': 'private, max-age=3600'
			}
		}
	);
};
