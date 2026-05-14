// F16 — Repair-session service. Cooldown-then-reflect flow for couples
// after a conflict. See drizzle/manual/0019_repair_sessions.sql for
// schema + RLS rationale.
//
// Service uses the service-role Drizzle client (bypasses RLS), so all
// callers MUST derive coupleId from `locals.couple` and userId from
// `locals.user` — never from the request body. The single-active
// session invariant is enforced by a partial unique index in Postgres.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { repairSessions, couple as coupleTable, profile } from '$lib/server/db/app.schema';
import {
	REPAIR_NOTE_MAX_LEN,
	REPAIR_COOLDOWN_MIN_MS,
	REPAIR_COOLDOWN_MAX_MS,
	REPAIR_COOLDOWN_DEFAULT_MS,
	type RepairStatus
} from '$lib/repair.constants';
import { recordAudit } from './audit';
import { awardForEvent } from './pet';

export {
	REPAIR_NOTE_MAX_LEN,
	REPAIR_COOLDOWN_MIN_MS,
	REPAIR_COOLDOWN_MAX_MS,
	REPAIR_COOLDOWN_DEFAULT_MS
};

export class RepairValidationError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'note_too_long'
			| 'cooldown_out_of_range'
			| 'session_not_found'
			| 'not_a_member'
			| 'already_active'
			| 'still_cooling'
			| 'wrong_status'
	) {
		super(message);
		this.name = 'RepairValidationError';
	}
}

export type RepairSession = {
	id: string;
	coupleId: string;
	initiatorId: string;
	status: RepairStatus;
	coolOffUntil: Date;
	initiatorNote: string | null;
	partnerId: string | null;
	partnerJoinedAt: Date | null;
	partnerNote: string | null;
	commitmentNote: string | null;
	ephemeral: boolean;
	startedAt: Date;
	completedAt: Date | null;
	cancelledAt: Date | null;
};

function normalizeNote(raw: unknown): string | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== 'string') return null;
	const t = raw.trim();
	if (t.length === 0) return null;
	if (t.length > REPAIR_NOTE_MAX_LEN) {
		throw new RepairValidationError(
			`note exceeds ${REPAIR_NOTE_MAX_LEN} characters`,
			'note_too_long'
		);
	}
	return t;
}

function rowToSession(r: typeof repairSessions.$inferSelect): RepairSession {
	return {
		id: r.id,
		coupleId: r.coupleId,
		initiatorId: r.initiatorId,
		status: r.status as RepairStatus,
		coolOffUntil: r.coolOffUntil,
		initiatorNote: r.initiatorNote,
		partnerId: r.partnerId,
		partnerJoinedAt: r.partnerJoinedAt,
		partnerNote: r.partnerNote,
		commitmentNote: r.commitmentNote,
		ephemeral: r.ephemeral,
		startedAt: r.startedAt,
		completedAt: r.completedAt,
		cancelledAt: r.cancelledAt
	};
}

/** Look up the single active (cooldown or reflecting) session for a couple. */
export async function getActiveSession(coupleId: string): Promise<RepairSession | null> {
	const rows = await db
		.select()
		.from(repairSessions)
		.where(
			and(
				eq(repairSessions.coupleId, coupleId),
				sql`${repairSessions.status} in ('cooldown', 'reflecting')`
			)
		)
		.limit(1);
	return rows[0] ? rowToSession(rows[0]) : null;
}

export async function getSessionById(coupleId: string, id: string): Promise<RepairSession | null> {
	const rows = await db
		.select()
		.from(repairSessions)
		.where(and(eq(repairSessions.id, id), eq(repairSessions.coupleId, coupleId)))
		.limit(1);
	return rows[0] ? rowToSession(rows[0]) : null;
}

export async function listHistory(coupleId: string, limit = 25): Promise<RepairSession[]> {
	const rows = await db
		.select()
		.from(repairSessions)
		.where(eq(repairSessions.coupleId, coupleId))
		.orderBy(desc(repairSessions.startedAt))
		.limit(limit);
	return rows.map(rowToSession);
}

export type StartRepairInput = {
	coupleId: string;
	initiatorId: string;
	cooldownMs?: number;
	initiatorNote?: string;
	ephemeral?: boolean;
};

export async function startSession(input: StartRepairInput): Promise<RepairSession> {
	const cd = input.cooldownMs ?? REPAIR_COOLDOWN_DEFAULT_MS;
	if (!Number.isFinite(cd) || cd < REPAIR_COOLDOWN_MIN_MS || cd > REPAIR_COOLDOWN_MAX_MS) {
		throw new RepairValidationError(
			`cooldown must be ${REPAIR_COOLDOWN_MIN_MS}–${REPAIR_COOLDOWN_MAX_MS} ms`,
			'cooldown_out_of_range'
		);
	}
	const note = normalizeNote(input.initiatorNote);
	const coolOffUntil = new Date(Date.now() + cd);

	try {
		const [row] = await db
			.insert(repairSessions)
			.values({
				coupleId: input.coupleId,
				initiatorId: input.initiatorId,
				status: 'cooldown',
				coolOffUntil,
				initiatorNote: note,
				ephemeral: input.ephemeral ?? false
			})
			.returning();
		await enqueuePartnerNotification(row.coupleId, input.initiatorId, row.id);
		await recordAudit(input.initiatorId, 'repair.start', {
			sessionId: row.id,
			coolOffUntil: coolOffUntil.toISOString(),
			ephemeral: row.ephemeral
		});
		return rowToSession(row);
	} catch (e) {
		// Partial unique index repair_sessions_one_active_per_couple
		// surfaces as a unique-violation when a session is already
		// open. Translate to a typed error so the API can return 409.
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes('repair_sessions_one_active_per_couple')) {
			throw new RepairValidationError(
				'A repair session is already active for this couple',
				'already_active'
			);
		}
		throw e;
	}
}

export type JoinRepairInput = {
	coupleId: string;
	sessionId: string;
	userId: string;
	partnerNote?: string;
};

export async function joinSession(input: JoinRepairInput): Promise<RepairSession> {
	const note = normalizeNote(input.partnerNote);
	const existing = await getSessionById(input.coupleId, input.sessionId);
	if (!existing) throw new RepairValidationError('session not found', 'session_not_found');
	if (existing.status !== 'cooldown' && existing.status !== 'reflecting') {
		throw new RepairValidationError(`session is ${existing.status}, cannot join`, 'wrong_status');
	}
	if (existing.initiatorId === input.userId) {
		// Initiator can also append/overwrite their own note (typed as
		// initiator_note in this case). Most apps would surface this as
		// "edit your note". Update the appropriate column.
		const [row] = await db
			.update(repairSessions)
			.set({
				initiatorNote: note ?? existing.initiatorNote,
				status: 'reflecting'
			})
			.where(eq(repairSessions.id, input.sessionId))
			.returning();
		return rowToSession(row);
	}
	const [row] = await db
		.update(repairSessions)
		.set({
			partnerId: input.userId,
			partnerJoinedAt: existing.partnerJoinedAt ?? new Date(),
			partnerNote: note ?? existing.partnerNote,
			status: 'reflecting'
		})
		.where(eq(repairSessions.id, input.sessionId))
		.returning();
	if (!existing.partnerJoinedAt) {
		await recordAudit(input.userId, 'repair.join', { sessionId: input.sessionId });
	}
	return rowToSession(row);
}

export type CompleteRepairInput = {
	coupleId: string;
	sessionId: string;
	userId: string;
	commitmentNote?: string;
};

export async function completeSession(input: CompleteRepairInput): Promise<RepairSession> {
	const note = normalizeNote(input.commitmentNote);
	const existing = await getSessionById(input.coupleId, input.sessionId);
	if (!existing) throw new RepairValidationError('session not found', 'session_not_found');
	if (existing.status === 'completed' || existing.status === 'cancelled') {
		throw new RepairValidationError(`session already ${existing.status}`, 'wrong_status');
	}
	if (existing.coolOffUntil.getTime() > Date.now()) {
		throw new RepairValidationError('cooldown has not elapsed yet', 'still_cooling');
	}
	const now = new Date();
	const [row] = await db
		.update(repairSessions)
		.set({
			status: 'completed',
			completedAt: now,
			commitmentNote: note ?? existing.commitmentNote
		})
		.where(eq(repairSessions.id, input.sessionId))
		.returning();
	await recordAudit(input.userId, 'repair.complete', {
		sessionId: input.sessionId,
		hadCommitmentNote: note !== null
	});
	// Pet earn (P2.2): mutual full pay, deduped per session.
	await awardForEvent({
		coupleId: input.coupleId,
		userId: input.userId,
		source: 'repair_complete',
		dedupeKey: `repair_complete:${input.sessionId}`,
		mutual: true
	});
	return rowToSession(row);
}

export async function cancelSession(input: {
	coupleId: string;
	sessionId: string;
	userId: string;
}): Promise<RepairSession> {
	const existing = await getSessionById(input.coupleId, input.sessionId);
	if (!existing) throw new RepairValidationError('session not found', 'session_not_found');
	if (existing.status === 'completed' || existing.status === 'cancelled') {
		throw new RepairValidationError(`session already ${existing.status}`, 'wrong_status');
	}
	const now = new Date();
	const [row] = await db
		.update(repairSessions)
		.set({ status: 'cancelled', cancelledAt: now })
		.where(eq(repairSessions.id, input.sessionId))
		.returning();
	await recordAudit(input.userId, 'repair.cancel', { sessionId: input.sessionId });
	return rowToSession(row);
}

// Push to the OTHER partner: "[name] would like to repair when you're
// ready." We deliberately do NOT include the initiator note in the
// push payload — too sensitive for a lockscreen.
async function enqueuePartnerNotification(
	coupleId: string,
	initiatorId: string,
	sessionId: string
): Promise<void> {
	try {
		await db.execute(sql`
			with c as (
				select case when partner_a = ${initiatorId} then partner_b else partner_a end as recipient_id
				from couple where id = ${coupleId}
			)
			insert into push_outbox (couple_id, recipient_id, kind, title, body, data_json, dedupe_key)
			select
				${coupleId},
				c.recipient_id,
				'repair_invite',
				coalesce(p.display_name, 'Your partner') || ' wants to repair when you''re ready',
				'Tap to open the repair flow.',
				json_build_object('sessionId', ${sessionId})::text,
				'repair_invite:' || ${sessionId}
			from c
			left join profile p on p.user_id = ${initiatorId}
			on conflict (recipient_id, dedupe_key) do nothing;
		`);
	} catch (e) {
		// Push enqueue failure must not block the repair flow.
		console.warn('[repair] failed to enqueue partner push', {
			sessionId,
			coupleId,
			e
		});
	}
}

// Resolve which partner the given user is in a couple row. Pure helper
// for tests + UI roles ("you-vs-them" labels in /repair).
export function rolesFor(userId: string, c: { partnerA: string; partnerB: string | null }) {
	const isA = c.partnerA === userId;
	const partnerId = isA ? c.partnerB : c.partnerA;
	return { isInitiatorRole: false, partnerId };
}

// Re-export the shared profile join target so callers that need a
// display name don't have to import it from the schema barrel.
export { coupleTable, profile };
