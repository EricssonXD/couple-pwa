// /pet — server load. Reuses the same auth + couple resolution as
// /api/pet so the snapshot is identical to what the client would
// fetch on its own. Welcome-back grant is intentionally kept on the
// REST endpoint side; the page load runs a read-only fetch so a
// reload does not re-trigger the grant accidentally.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import { getPetState } from '$lib/server/services/pet';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) redirect(303, '/onboarding/link');

	const snapshot = await getPetState(couple.id, null);
	return { snapshot };
};
