import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PairingError, redeemLinkCode } from '$lib/server/services/couple';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Sign in required');
	const { code } = (await request.json().catch(() => ({}))) as { code?: string };
	if (typeof code !== 'string' || code.trim().length < 4) error(400, 'Code required');

	try {
		const created = await redeemLinkCode(code, locals.user.id);
		return json({ couple: created }, { status: 201 });
	} catch (err) {
		if (err instanceof PairingError) {
			const status =
				err.code === 'not_found'
					? 404
					: err.code === 'expired' || err.code === 'used'
						? 410
						: err.code === 'self_redeem'
							? 400
							: 409;
			error(status, err.message);
		}
		throw err;
	}
};
