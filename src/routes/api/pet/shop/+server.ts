// DuoSync — pet shop catalogue.
//
// GET → ShopItemView[] (catalogue with per-couple ownership + lock state).
// Reachable through pause/unpair so partners can window-shop.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import { listShopItems } from '$lib/server/services/pet';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) error(409, 'not_paired');

	const items = await listShopItems(couple.id);
	return json({ items });
};
