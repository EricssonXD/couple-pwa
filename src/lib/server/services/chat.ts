// F7 — couple-only chat service. Text messages with a hard 7-day TTL
// (RLS SELECT policy + hourly cron purge — see drizzle/manual/0020 +
// 0021). Service uses the privileged db client; all callers MUST
// derive coupleId from `locals.couple` and userId from `locals.user`.
//
// Realtime: server emits a `chat_message` ServerEvent on the couple's
// private channel. The body IS included in the realtime payload (the
// channel is RLS-scoped to couple members), but is NEVER included in
// the push payload — the lockscreen only sees "<sender> sent a
// message", mirroring F16's privacy stance.
//
// No per-message audit log. Chat is sensitive and high-volume; only
// audit configuration toggles (none yet) — never message content.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { chatMessages, profile } from '$lib/server/db/app.schema';
import { broadcastToCouple } from '$lib/server/realtime';
import {
	CHAT_BODY_MAX_LEN,
	CHAT_BODY_MIN_LEN,
	CHAT_HISTORY_DEFAULT_LIMIT,
	CHAT_HISTORY_MAX_LIMIT,
	CHAT_RETENTION_DAYS
} from '$lib/chat.constants';

export {
	CHAT_BODY_MAX_LEN,
	CHAT_BODY_MIN_LEN,
	CHAT_HISTORY_DEFAULT_LIMIT,
	CHAT_HISTORY_MAX_LIMIT,
	CHAT_RETENTION_DAYS
};

export class ChatValidationError extends Error {
	constructor(
		message: string,
		readonly code: 'body_empty' | 'body_too_long' | 'invalid_cursor' | 'invalid_limit'
	) {
		super(message);
		this.name = 'ChatValidationError';
	}
}

export type ChatMessage = {
	id: string;
	coupleId: string;
	senderId: string;
	body: string;
	createdAt: Date;
};

function rowToMessage(r: typeof chatMessages.$inferSelect): ChatMessage {
	return {
		id: r.id,
		coupleId: r.coupleId,
		senderId: r.senderId,
		body: r.body,
		createdAt: r.createdAt
	};
}

function normalizeBody(raw: unknown): string {
	if (typeof raw !== 'string') {
		throw new ChatValidationError('body must be a string', 'body_empty');
	}
	const t = raw.trim();
	if (t.length < CHAT_BODY_MIN_LEN) {
		throw new ChatValidationError('body is empty', 'body_empty');
	}
	if (t.length > CHAT_BODY_MAX_LEN) {
		throw new ChatValidationError(`body exceeds ${CHAT_BODY_MAX_LEN} characters`, 'body_too_long');
	}
	return t;
}

function retentionFloor(): Date {
	return new Date(Date.now() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export type ListMessagesInput = {
	coupleId: string;
	/** Composite cursor — return messages strictly OLDER than this point. */
	before?: { createdAt: Date; id: string };
	limit?: number;
};

export type ListMessagesResult = {
	messages: ChatMessage[];
	/** Cursor to pass as `before` to fetch the next (older) page. */
	nextCursor: { createdAt: string; id: string } | null;
};

export async function listMessages(input: ListMessagesInput): Promise<ListMessagesResult> {
	const requested = Math.floor(input.limit ?? CHAT_HISTORY_DEFAULT_LIMIT);
	if (!Number.isFinite(requested) || requested < 1) {
		throw new ChatValidationError('limit must be a positive integer', 'invalid_limit');
	}
	const limit = Math.min(requested, CHAT_HISTORY_MAX_LIMIT);

	// Defence-in-depth: filter by retention window even though the
	// hourly cron physically deletes expired rows. Eventual consistency
	// could otherwise leak rows up to ~1h past the boundary.
	const floor = retentionFloor();

	let cursorWhere = sql`true`;
	if (input.before) {
		const c = input.before;
		if (!(c.createdAt instanceof Date) || Number.isNaN(c.createdAt.getTime()) || !c.id) {
			throw new ChatValidationError('invalid cursor', 'invalid_cursor');
		}
		// Tuple compare: rows strictly OLDER than (createdAt, id) when
		// ordering DESC, DESC. Using the indexed (couple_id, created_at
		// DESC, id DESC) keeps this an index-range scan.
		cursorWhere = sql`(${chatMessages.createdAt}, ${chatMessages.id}) < (${c.createdAt}, ${c.id})`;
	}

	const rows = await db
		.select()
		.from(chatMessages)
		.where(
			and(
				eq(chatMessages.coupleId, input.coupleId),
				gte(chatMessages.createdAt, floor),
				cursorWhere
			)
		)
		.orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	const nextCursor =
		hasMore && page.length > 0
			? {
					createdAt: page[page.length - 1].createdAt.toISOString(),
					id: page[page.length - 1].id
				}
			: null;
	return { messages: page.map(rowToMessage), nextCursor };
}

export type SendMessageInput = {
	coupleId: string;
	senderId: string;
	body: string;
};

export async function sendMessage(input: SendMessageInput): Promise<ChatMessage> {
	const body = normalizeBody(input.body);
	const [row] = await db
		.insert(chatMessages)
		.values({
			coupleId: input.coupleId,
			senderId: input.senderId,
			body
		})
		.returning();
	const message = rowToMessage(row);

	// Best-effort side effects — never fail the send because realtime
	// or push enqueue hiccupped. Repo pattern (see services/moments.ts).
	void broadcastToCouple(input.coupleId, {
		t: 'chat_message',
		ts: message.createdAt.getTime(),
		p: {
			id: message.id,
			senderId: message.senderId,
			body: message.body,
			createdAt: message.createdAt.toISOString()
		}
	}).catch((e) => {
		console.warn('[chat] broadcast failed', { messageId: message.id, e });
	});

	void enqueuePartnerNotification(input.coupleId, input.senderId, message).catch((e) => {
		console.warn('[chat] push enqueue failed', { messageId: message.id, e });
	});

	return message;
}

// Push to the OTHER partner: "<sender_name> sent a message". We
// deliberately omit the body — too sensitive for a lockscreen.
//
// Coalescing: dedupe_key uses a 1-minute time bucket so a flurry of
// messages within the same minute only produces ONE push for the
// recipient. Subsequent minutes will produce a fresh push, which is
// still much gentler than 30/min.
async function enqueuePartnerNotification(
	coupleId: string,
	senderId: string,
	message: ChatMessage
): Promise<void> {
	const minuteBucket = Math.floor(message.createdAt.getTime() / 60_000);
	await db.execute(sql`
		with c as (
			select case when partner_a = ${senderId} then partner_b else partner_a end as recipient_id
			from couple where id = ${coupleId}
		)
		insert into push_outbox (couple_id, recipient_id, kind, title, body, data_json, dedupe_key)
		select
			${coupleId},
			c.recipient_id,
			'chat_message',
			coalesce(p.display_name, 'Your partner') || ' sent a message',
			'Tap to open chat.',
			json_build_object('messageId', ${message.id})::text,
			'chat:' || c.recipient_id || ':' || ${minuteBucket}
		from c
		left join profile p on p.user_id = ${senderId}
		on conflict (recipient_id, dedupe_key) do nothing;
	`);
}

// Convenience helper for a future "you have N unread" surface — not
// used by v1 UI but cheap to expose so we don't have to revisit the
// service layer to add it. Counts messages in (since, now] sent by
// the OTHER partner (not the recipient).
export async function countUnreadForRecipient(
	coupleId: string,
	recipientId: string,
	since: Date
): Promise<number> {
	const rows = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(chatMessages)
		.where(
			and(
				eq(chatMessages.coupleId, coupleId),
				gte(chatMessages.createdAt, since),
				sql`${chatMessages.senderId} <> ${recipientId}`
			)
		);
	return rows[0]?.n ?? 0;
}

// Re-export profile for callers that need to attach display names.
export { profile };
