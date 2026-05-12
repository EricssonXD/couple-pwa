/**
 * F7 — /api/chat
 *
 * GET  → { messages: ChatMessage[], nextCursor: { createdAt, id } | null }
 *        Query: ?before=<iso>:<id>&limit=<n>
 * POST → send a message; returns the canonical row.
 *        Body: { body: string, clientId?: string } — clientId is echoed
 *        back so the optimistic-send UI can reconcile.
 *
 * Errors map ChatValidationError.code → 400. Rate-limit returns 429.
 *
 * SSR-safe note: this endpoint never appears in any +page.server.ts
 * load — chat history is fetched client-side AFTER hydration so the
 * 7-day TTL cannot be defeated by an HTML / __data.json cache. See
 * src/service-worker.ts isPrivatePath.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import {
	listMessages,
	sendMessage,
	ChatValidationError,
	CHAT_HISTORY_DEFAULT_LIMIT,
	CHAT_HISTORY_MAX_LIMIT
} from '$lib/server/services/chat';

function parseCursor(raw: string | null): { createdAt: Date; id: string } | undefined {
	if (!raw) return undefined;
	// Cursor format: "<iso8601>:<uuid>" — colon-separated to keep it
	// tidy in URL bars and easy to round-trip without escaping.
	const idx = raw.lastIndexOf(':');
	if (idx <= 0) return undefined;
	const isoPart = raw.slice(0, idx);
	const idPart = raw.slice(idx + 1);
	const ts = new Date(isoPart);
	if (Number.isNaN(ts.getTime()) || idPart.length === 0) return undefined;
	return { createdAt: ts, id: idPart };
}

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const before = parseCursor(url.searchParams.get('before'));
	let limit: number | undefined;
	const limitRaw = url.searchParams.get('limit');
	if (limitRaw !== null) {
		const n = Number(limitRaw);
		if (!Number.isFinite(n) || n < 1) {
			return new Response(JSON.stringify({ error: 'invalid_limit' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}
		limit = Math.min(Math.floor(n), CHAT_HISTORY_MAX_LIMIT);
	} else {
		limit = CHAT_HISTORY_DEFAULT_LIMIT;
	}

	try {
		const result = await listMessages({
			coupleId: locals.couple.id,
			before,
			limit
		});
		return json(result);
	} catch (e) {
		if (e instanceof ChatValidationError) {
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('chat-write', locals.user.id);
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
		return new Response(JSON.stringify({ error: 'invalid_json' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	const clientId = typeof body.clientId === 'string' ? body.clientId : null;

	try {
		const message = await sendMessage({
			coupleId: locals.couple.id,
			senderId: locals.user.id,
			body: typeof body.body === 'string' ? body.body : ''
		});
		return json({ ok: true, message, clientId });
	} catch (e) {
		if (e instanceof ChatValidationError) {
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
