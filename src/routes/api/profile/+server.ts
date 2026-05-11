import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateProfile, ProfileError } from '$lib/server/services/couple';
import { consume } from '$lib/server/rate-limit';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	const limit = consume('profile-write', locals.user.id);
	if (!limit.allowed) {
		return new Response(JSON.stringify({ error: 'rate_limited' }), {
			status: 429,
			headers: {
				'content-type': 'application/json',
				'retry-after': String(Math.ceil(limit.retryAfterMs / 1000))
			}
		});
	}
	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'invalid_json');
	}
	try {
		await updateProfile(locals.user.id, {
			displayName: body.displayName != null ? String(body.displayName) : undefined,
			avatarEmoji: body.avatarEmoji != null ? String(body.avatarEmoji) : undefined
		});
		return json({ ok: true });
	} catch (e) {
		if (e instanceof ProfileError) error(400, e.code);
		throw e;
	}
};
