import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	requestAccountDeletion,
	cancelAccountDeletion,
	readDeletionState,
	DeletionError
} from '$lib/server/services/deletion';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	const state = await readDeletionState(locals.user.id);
	return json({ pendingUntil: state?.pendingUntil ?? null });
};

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	try {
		const { pendingUntil } = await requestAccountDeletion(locals.user.id);
		return json({ pendingUntil });
	} catch (e) {
		if (e instanceof DeletionError) error(409, e.code);
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	try {
		await cancelAccountDeletion(locals.user.id);
		return json({ ok: true });
	} catch (e) {
		if (e instanceof DeletionError) error(409, e.code);
		throw e;
	}
};
