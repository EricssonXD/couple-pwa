import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';

/**
 * Exposes the VAPID public key so the client can call
 * `pushManager.subscribe({ applicationServerKey })`. Public-by-design;
 * the matching private key lives only in the N3 delivery worker as a
 * secret. Returns 503 when the key isn't configured so the UI can hide
 * the "enable notifications" CTA.
 */
export const GET: RequestHandler = async () => {
	const key = env.PUBLIC_VAPID_KEY;
	if (!key) error(503, 'push_not_configured');
	return json({ key });
};
