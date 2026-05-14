// DuoSync — pet read/rename endpoints.
//
// GET   → snapshot (pet, wallet, equipped, serverNow, welcomeBack).
// PATCH → rename ({ name }).
//
// Couple is loaded via `loadCoupleAnyStatus` (B1) so the pet stays
// reachable through pause/unpair. Writes still succeed; only the
// realtime broadcast is skipped when status ≠ active.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import {
	PetValidationError,
	broadcastPetState,
	getPetState,
	maybeGrantWelcomeBack,
	renamePet
} from '$lib/server/services/pet';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) error(409, 'not_paired');

	const welcomeBack = await maybeGrantWelcomeBack(couple.id, locals.user.id);
	const snap = await getPetState(couple.id, welcomeBack);
	return json(snap);
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
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
		const snap = await renamePet(couple.id, body.name);
		await broadcastPetState(couple.id, couple.status);
		return json(snap);
	} catch (e) {
		if (e instanceof PetValidationError) {
			const status = e.code === 'pet_not_found' ? 404 : 400;
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
