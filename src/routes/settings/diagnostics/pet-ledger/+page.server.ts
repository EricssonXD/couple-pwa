// /settings/diagnostics/pet-ledger — paginated read-only audit of
// pet ledger + manual reconcile button. Server-loaded; the page only
// posts the reconcile mutation.

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import { getPetLedger } from '$lib/server/services/pet';

const PAGE_LIMIT = 50;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) error(401, 'unauthorized');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) error(409, 'not_paired');

	const pageRaw = Number(url.searchParams.get('page') ?? '1');
	const page = Number.isFinite(pageRaw) ? Math.max(1, Math.min(1000, Math.floor(pageRaw))) : 1;

	const entries = await getPetLedger(couple.id, { page, limit: PAGE_LIMIT });
	return {
		page,
		limit: PAGE_LIMIT,
		entries,
		hasNext: entries.length === PAGE_LIMIT
	};
};
