import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bucketFor, getPulseState } from '$lib/server/services/location';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const state = await getPulseState(locals.user.id, locals.couple.id);
	return json({
		me: state.mine && {
			capturedAt: state.mine.capturedAt,
			batteryPct: state.mine.batteryPct,
			charging: state.mine.charging
		},
		partner: state.partner,
		distanceM: state.distanceM,
		bucket: bucketFor(state.distanceM)
	});
};
