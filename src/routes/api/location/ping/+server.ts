import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LocationError, recordPing } from '$lib/server/services/location';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'invalid_json');
	}
	if (!body || typeof body !== 'object') error(400, 'invalid_body');
	const b = body as Record<string, unknown>;

	try {
		const row = await recordPing(locals.user.id, locals.couple.id, {
			lat: Number(b.lat),
			lon: Number(b.lon),
			accuracyM: b.accuracyM != null ? Number(b.accuracyM) : undefined,
			batteryPct: b.batteryPct != null ? Math.round(Number(b.batteryPct)) : undefined,
			charging: typeof b.charging === 'boolean' ? b.charging : undefined,
			headingDeg: b.headingDeg != null ? Number(b.headingDeg) : undefined,
			speedMps: b.speedMps != null ? Number(b.speedMps) : undefined,
			capturedAt: b.capturedAt ? new Date(String(b.capturedAt)) : new Date()
		});
		return json({ ok: true, accepted: row !== null });
	} catch (e) {
		if (e instanceof LocationError) {
			const status = e.code === 'no_couple' ? 409 : 400;
			error(status, e.code);
		}
		throw e;
	}
};
