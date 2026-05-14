// DuoSync — pet inventory.
//
// GET → PetInventoryEntry[] (every item the couple owns, including
// qty=0 treat rows kept for history).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import { getPetInventory } from '$lib/server/services/pet';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) error(409, 'not_paired');

	const inventory = await getPetInventory(couple.id);
	return json({ inventory });
};
