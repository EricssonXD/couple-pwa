// /pet — server load. Reuses the same auth + couple resolution as
// /api/pet so the snapshot is identical to what the client would
// fetch on its own. Welcome-back grant is intentionally kept on the
// REST endpoint side; the page load runs a read-only fetch so a
// reload does not re-trigger the grant accidentally.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadCoupleAnyStatus } from '$lib/server/services/couple';
import {
	getPetState,
	listShopItems,
	getPetInventory,
	getPetLedger
} from '$lib/server/services/pet';
import { recordAudit } from '$lib/server/services/audit';

// Per-session marker so `pet.visit` is logged at most once per browser
// session per user, not on every reload. Session cookies expire when
// the browser closes — exactly the cadence the spec asks for ("first
// /pet mount per session"). HttpOnly so the client can't forge it.
const PET_VISIT_COOKIE = 'ds_pet_visit';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	const couple = await loadCoupleAnyStatus(locals.user.id);
	if (!couple) redirect(303, '/onboarding/link');

	// Fetch shop + inventory alongside the snapshot so the Shop and
	// Wardrobe tabs render immediately on first paint with no follow-up
	// round-trip. Catalogue is small (12 rows) so the cost is negligible
	// and we avoid lazy-fetch race conditions when toggling tabs fast.
	const [snapshot, shopItems, inventory, ledger] = await Promise.all([
		getPetState(couple.id, null),
		listShopItems(couple.id),
		getPetInventory(couple.id),
		getPetLedger(couple.id, { limit: 5 })
	]);

	// Telemetry (P6.6): one audit row per browser session per user.
	// Non-blocking: recordAudit swallows its own errors so a flaky audit
	// write never breaks the page render.
	if (!cookies.get(PET_VISIT_COOKIE)) {
		cookies.set(PET_VISIT_COOKIE, '1', {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true
			// no maxAge → session cookie, cleared when the browser closes
		});
		void recordAudit(locals.user.id, 'pet.visit', { coupleStatus: couple.status });
	}

	return {
		snapshot,
		shopItems,
		inventory,
		ledger,
		coupleId: couple.id,
		userId: locals.user.id,
		// Inactive couples (paused / broken) skip realtime entirely:
		// the broadcast emitter no-ops on the server side AND the
		// realtime RLS policy denies non-active members. The page
		// renders a "Sync paused — refresh to update." notice and
		// does not subscribe to the channel (avoids reconnect loops).
		realtimePaused: couple.status !== 'active'
	};
};
