// F11 H7 — POST /api/cron/hourly-purge
//
// Drains the F11 Storage cleanup queues:
//   1. hourly_clip rows in status='delete_pending' — removes the
//      Storage object then hard-deletes (or marks 'deleted') the row.
//   2. hourly_clip_attempt rows whose finalized_at IS NULL and whose
//      expires_at < now() - 15min — best-effort Storage remove +
//      hard-delete row.
//
// pg_cron handles the row-state transitions (0025_hourly.sql); only
// the Storage object eviction has to ride a TS worker because pg_cron
// cannot reach Supabase Storage directly.
//
// Auth: shared-secret header `x-cron-secret` MUST match
// env.CRON_SHARED_SECRET. Requests without it 401.

import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { purgeDeletePending, purgeOrphanAttemptObjects } from '$lib/server/services/hourly';

export const POST: RequestHandler = async ({ request }) => {
	const expected = env.CRON_SHARED_SECRET;
	if (!expected) error(503, 'cron_secret_not_configured');
	const got = request.headers.get('x-cron-secret');
	if (got !== expected) error(401, 'unauthorized');

	const clips = await purgeDeletePending(100);
	const attempts = await purgeOrphanAttemptObjects(100);
	return json({
		ok: true,
		clips,
		attempts
	});
};
