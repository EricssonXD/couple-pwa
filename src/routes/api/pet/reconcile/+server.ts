// DuoSync — reconcile pet wallet against ledger.
//
// POST → { adjusted: number, snapshot, inventory }
// 401 unauthorized, 409 not_paired.
//
// Idempotent. `adjusted === 0` means wallet was already correct.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import { broadcastPetState, reconcileWallet } from '$lib/server/services/pet';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) error(409, 'not_paired');

	const { adjusted, result } = await reconcileWallet(couple.id);
	if (adjusted !== 0) {
		await broadcastPetState(couple.id, couple.status);
	}
	return json({ adjusted, ...result });
};
