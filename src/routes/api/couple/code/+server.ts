import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getActiveCouple, getLiveLinkCode, issueLinkCode } from '$lib/server/services/couple';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Sign in required');
	const live = await getLiveLinkCode(locals.user.id);
	return json(live ? { code: live.code, expiresAt: live.expiresAt } : { code: null });
};

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Sign in required');
	if (await getActiveCouple(locals.user.id)) error(409, 'Already paired');

	// Reuse a live code instead of spawning duplicates.
	const existing = await getLiveLinkCode(locals.user.id);
	if (existing) return json({ code: existing.code, expiresAt: existing.expiresAt });

	const issued = await issueLinkCode(locals.user.id);
	return json(issued, { status: 201 });
};
