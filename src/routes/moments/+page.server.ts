// /moments — hub landing. Hourly is the primary moments surface;
// the long-form geo-feed lives at /moments/feed (reachable via the
// hub chip row). This wrapper redirects so the bottom nav, hub chips,
// and any legacy /moments links all land users on the hourly pager.

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	redirect(307, '/hourly');
};
