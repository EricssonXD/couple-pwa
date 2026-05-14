// H5 audit log service. Append-only writes from inside server-only
// service code (location.setGhostMode, couple.unpair, account.requestDeletion).
// Never throws from the caller's perspective — audit failures must not
// block the action they describe.

import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export type AuditAction =
	| 'ghost.enable'
	| 'ghost.disable'
	| 'unpair.request'
	| 'account.delete.request'
	| 'account.delete.cancel'
	| 'repair.start'
	| 'repair.join'
	| 'repair.complete'
	| 'repair.cancel'
	| 'pet.award.failed';

export async function recordAudit(
	userId: string,
	action: AuditAction,
	metadata?: Record<string, unknown>
): Promise<void> {
	try {
		await db.insert(auditLog).values({
			userId,
			action,
			metadata: metadata ?? null
		});
	} catch (e) {
		// Don't propagate — audit is observability, not a hard requirement.
		console.warn('[audit] failed to record', { action, userId, e });
	}
}

export type AuditEntry = {
	id: string;
	action: string;
	metadata: unknown;
	createdAt: Date;
};

export async function listAudit(userId: string, limit = 50): Promise<AuditEntry[]> {
	const rows = await db
		.select({
			id: auditLog.id,
			action: auditLog.action,
			metadata: auditLog.metadata,
			createdAt: auditLog.createdAt
		})
		.from(auditLog)
		.where(eq(auditLog.userId, userId))
		.orderBy(desc(auditLog.createdAt))
		.limit(limit);
	return rows.map((r) => ({
		id: r.id,
		action: r.action,
		metadata: r.metadata,
		createdAt: r.createdAt as Date
	}));
}
