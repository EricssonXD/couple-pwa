// /pet — server load. Reuses the same auth + couple resolution as
// /api/pet so the snapshot is identical to what the client would
// fetch on its own. Welcome-back grant is intentionally kept on the
// REST endpoint side; the page load runs a read-only fetch so a
// reload does not re-trigger the grant accidentally.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import { getPetState, listShopItems, getPetInventory } from '$lib/server/services/pet';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) redirect(303, '/onboarding/link');

	// Fetch shop + inventory alongside the snapshot so the Shop and
	// Wardrobe tabs render immediately on first paint with no follow-up
	// round-trip. Catalogue is small (12 rows) so the cost is negligible
	// and we avoid lazy-fetch race conditions when toggling tabs fast.
	const [snapshot, shopItems, inventory] = await Promise.all([
		getPetState(couple.id, null),
		listShopItems(couple.id),
		getPetInventory(couple.id)
	]);

	return { snapshot, shopItems, inventory };
};
