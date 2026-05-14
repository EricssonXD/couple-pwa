// DuoSync — Daily Question service.
//
// One curated prompt per day per couple, deterministic by date.
// Each partner writes a private answer; once both have answered, both
// answers are revealed.
//
// Trust boundary: this module runs server-side with the privileged
// Drizzle client (postgres superuser bypasses RLS). RLS policies on
// daily_question_answer enforce the "reveal-after-both" rule for any
// future direct-from-browser supabase-js queries; here we mirror the
// same logic explicitly.

import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { couple as coupleTable, dailyQuestion, dailyQuestionAnswer } from '$lib/server/db/schema';
import { awardForEvent } from '$lib/server/services/pet';

type Couple = typeof coupleTable.$inferSelect;

export class DailyError extends Error {
	constructor(
		public code: 'no_couple' | 'no_questions' | 'invalid_body' | 'already_answered' | 'not_found',
		message?: string
	) {
		super(message ?? code);
		this.name = 'DailyError';
	}
}

const MAX_BODY = 1000;

export function todayKey(now: Date = new Date()): string {
	// UTC date key. Same prompt across timezones for a couple — simpler &
	// avoids "we got a different question" complaints when partners are in
	// different zones.
	return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

// FNV-1a 32-bit hash → stable, no deps.
export function hash32(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
	}
	return h >>> 0;
}

export type DailyAnswer = {
	id: string;
	userId: string;
	body: string;
	createdAt: Date;
};

export type DailyQuestionView = {
	question: { id: string; promptEn: string; promptZh: string | null };
	dateKey: string;
	mine: DailyAnswer | null;
	partner: DailyAnswer | null;
	revealed: boolean;
};

export async function getOrPickQuestionFor(
	coupleId: string,
	dateKey: string = todayKey()
): Promise<typeof dailyQuestion.$inferSelect> {
	const all = await db.select().from(dailyQuestion).where(eq(dailyQuestion.active, true));
	if (all.length === 0) throw new DailyError('no_questions');

	// Deterministic: hash(coupleId|dateKey) → index.
	const idx = hash32(`${coupleId}|${dateKey}`) % all.length;
	return all[idx];
}

export async function loadDaily(
	viewerId: string,
	couple: Couple,
	dateKey: string = todayKey()
): Promise<DailyQuestionView> {
	const question = await getOrPickQuestionFor(couple.id, dateKey);
	const partnerId = couple.partnerA === viewerId ? couple.partnerB : couple.partnerA;

	const rows = await db
		.select()
		.from(dailyQuestionAnswer)
		.where(
			and(
				eq(dailyQuestionAnswer.coupleId, couple.id),
				eq(dailyQuestionAnswer.questionId, question.id)
			)
		);

	const mine = rows.find((r) => r.userId === viewerId) ?? null;
	const partnerRow = rows.find((r) => r.userId === partnerId) ?? null;
	const revealed = !!mine && !!partnerRow;

	return {
		question: {
			id: question.id,
			promptEn: question.promptEn,
			promptZh: question.promptZh
		},
		dateKey,
		mine: mine
			? { id: mine.id, userId: mine.userId, body: mine.body, createdAt: mine.createdAt }
			: null,
		partner:
			revealed && partnerRow
				? {
						id: partnerRow.id,
						userId: partnerRow.userId,
						body: partnerRow.body,
						createdAt: partnerRow.createdAt
					}
				: null,
		revealed
	};
}

export async function submitDailyAnswer(
	viewerId: string,
	couple: Couple,
	body: string,
	dateKey: string = todayKey()
): Promise<DailyQuestionView> {
	const trimmed = body.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_BODY) {
		throw new DailyError('invalid_body');
	}

	const question = await getOrPickQuestionFor(couple.id, dateKey);

	const existing = await db
		.select({ id: dailyQuestionAnswer.id })
		.from(dailyQuestionAnswer)
		.where(
			and(
				eq(dailyQuestionAnswer.coupleId, couple.id),
				eq(dailyQuestionAnswer.questionId, question.id),
				eq(dailyQuestionAnswer.userId, viewerId)
			)
		)
		.limit(1);

	if (existing.length > 0) throw new DailyError('already_answered');

	await db.insert(dailyQuestionAnswer).values({
		coupleId: couple.id,
		questionId: question.id,
		userId: viewerId,
		body: trimmed
	});

	// Pet earn (P2.2): always grant daily_send to the answering partner
	// (solo, ½ pay). If THIS insert was the second one, the question
	// just flipped to revealed → also grant daily_reveal (mutual, full
	// pay) under a question-scoped dedupe key. W7 — fired only from
	// the write path; loadDaily stays read-only.
	await awardForEvent({
		coupleId: couple.id,
		userId: viewerId,
		source: 'daily_send',
		dedupeKey: `daily_send:${viewerId}:${dateKey}`,
		mutual: false
	});
	const answerCount = await db
		.select({ id: dailyQuestionAnswer.id })
		.from(dailyQuestionAnswer)
		.where(
			and(
				eq(dailyQuestionAnswer.coupleId, couple.id),
				eq(dailyQuestionAnswer.questionId, question.id)
			)
		);
	if (answerCount.length >= 2) {
		await awardForEvent({
			coupleId: couple.id,
			userId: viewerId,
			source: 'daily_reveal',
			dedupeKey: `daily_reveal:${question.id}:${dateKey}`,
			mutual: true
		});
	}

	return loadDaily(viewerId, couple, dateKey);
}
