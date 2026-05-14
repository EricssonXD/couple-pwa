// DuoSync — equip / unequip a cosmetic.
//
// POST { itemId, equipped } → { snapshot, inventory }.
// 400 item_not_cosmetic, 404 item/pet not found, 409 inventory_empty.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import {
	PetShopError,
	broadcastPetState,
	equipCosmetic,
	petShopErrorStatus
} from '$lib/server/services/pet';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'unauthorized');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) error(409, 'not_paired');

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'invalid_json');
	}
	const itemId = body.itemId;
	const equipped = body.equipped;
	if (typeof itemId !== 'string' || !itemId) error(400, 'item_id_required');
	if (typeof equipped !== 'boolean') error(400, 'equipped_required');

	try {
		const result = await equipCosmetic(couple.id, itemId, equipped);
		await broadcastPetState(couple.id, couple.status);
		return json(result);
	} catch (e) {
		if (e instanceof PetShopError) {
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status: petShopErrorStatus(e.code),
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
