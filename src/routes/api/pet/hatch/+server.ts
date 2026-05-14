// DuoSync — pet hatch endpoint.
//
// POST { species, name } → snapshot. Errors:
//   species_invalid | name_empty | name_too_long → 400
//   pet_already_exists → 409

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import { PetValidationError, broadcastPetState, hatchPet } from '$lib/server/services/pet';

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

	try {
		const snap = await hatchPet(couple.id, body.species, body.name);
		await broadcastPetState(couple.id, couple.status);
		return json(snap);
	} catch (e) {
		if (e instanceof PetValidationError) {
			const status = e.code === 'pet_already_exists' ? 409 : 400;
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
