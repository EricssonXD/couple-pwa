// F11 — GET /api/hourly/day?date=YYYY-MM-DD
//
// Returns both partners' clips + moods for the requested UTC day,
// with freshly-minted short-TTL signed playback URLs (60s) per cell.
//
// `date` is REQUIRED and bounded to a single day. The route never
// accepts arbitrary ranges — keeps the playback-url forge volume
// bounded and the per-page payload small.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDay } from '$lib/server/services/hourly';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const date = url.searchParams.get('date') ?? '';
	if (!DATE_RE.test(date)) error(400, 'invalid_date');

	const partnerId =
		locals.couple.partnerA === locals.user.id ? locals.couple.partnerB : locals.couple.partnerA;

	const payload = await getDay({
		coupleId: locals.couple.id,
		viewerId: locals.user.id,
		partnerId,
		dateIso: date
	});
	return json(payload);
};
