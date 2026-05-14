import type { LayoutServerLoad } from './$types';
import { awardForEvent } from '$lib/server/services/pet';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// Pet earn (P2.2 W7): anniversary check on every layout load. The
	// dedupeKey is year-scoped so awardForEvent is a no-op after the
	// first hit each year. Skipped when no couple, no anniversary,
	// or status is not active. Failures swallowed inside awardForEvent.
	if (locals.user && locals.couple?.anniversary && locals.couple.status === 'active') {
		const today = new Date();
		const todayMd = `${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
		const annMd = locals.couple.anniversary.slice(5); // YYYY-MM-DD → MM-DD
		if (todayMd === annMd) {
			await awardForEvent({
				coupleId: locals.couple.id,
				userId: locals.user.id,
				source: 'anniversary',
				dedupeKey: `anniversary:${today.getUTCFullYear()}`,
				mutual: true
			});
		}
	}

	return {
		user: locals.user ?? null,
		couple: locals.couple ?? null,
		pathname: url.pathname
	};
};
