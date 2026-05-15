// DuoSync — pet ledger (P5.2).
//
// GET /api/pet/ledger?page=N&limit=M → { entries: PetLedgerEntry[] }
//
// Default limit=5 powers the /pet "Recent activity" strip.
// Diagnostics passes limit=50 + page paging.
// `user_id` is never returned (W3 privacy guarantee).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import { getPetLedger } from '$lib/server/services/pet';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'unauthorized');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) error(409, 'not_paired');

	const limitRaw = url.searchParams.get('limit');
	const pageRaw = url.searchParams.get('page');
	const limit = limitRaw == null ? undefined : Number.parseInt(limitRaw, 10);
	const page = pageRaw == null ? undefined : Number.parseInt(pageRaw, 10);
	if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
		error(400, 'limit_invalid');
	}
	if (page !== undefined && (!Number.isFinite(page) || page < 1)) {
		error(400, 'page_invalid');
	}

	const entries = await getPetLedger(couple.id, { page, limit });
	return json({ entries });
};
