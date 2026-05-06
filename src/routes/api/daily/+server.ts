import { json, error } from '@sveltejs/kit';
import { DailyError, loadDaily, submitDailyAnswer } from '$lib/server/services/daily';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'no_couple');
	try {
		const view = await loadDaily(locals.user.id, locals.couple);
		return json(view);
	} catch (e) {
		if (e instanceof DailyError) error(400, e.code);
		throw e;
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'no_couple');
	const body = (await request.json().catch(() => ({}))) as { body?: unknown };
	if (typeof body.body !== 'string') error(400, 'invalid_body');
	try {
		const view = await submitDailyAnswer(locals.user.id, locals.couple, body.body);
		return json(view);
	} catch (e) {
		if (e instanceof DailyError) {
			if (e.code === 'invalid_body') error(400, e.code);
			if (e.code === 'already_answered') error(409, e.code);
			error(400, e.code);
		}
		throw e;
	}
};
