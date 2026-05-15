// DuoSync Postgres schema (Supabase-flavored).
//
// Key differences from the Better-Auth era:
// - User identity lives in `auth.users` (Supabase-managed). We declare it
//   here only so Drizzle can typecheck FKs; drizzle-kit ignores the `auth`
//   schema in introspection (configured in drizzle.config.ts).
// - Every former `text('user_id').references(user.id)` is now
//   `uuid('user_id').references(authUsers.id)`.
// - `couple.id` switched from text+gen_random_uuid to native uuid.
// - The DuoSync `profile` table now uses the auth.users id as its PK,
//   making it a true 1:1 extension of the Supabase user row.

import { relations, sql } from 'drizzle-orm';
import {
	pgSchema,
	pgTable,
	primaryKey,
	text,
	timestamp,
	date,
	uniqueIndex,
	index,
	check,
	doublePrecision,
	integer,
	numeric,
	boolean,
	uuid,
	jsonb,
	customType
} from 'drizzle-orm/pg-core';

// PostGIS geography point (SRID 4326). We declare the column as plain
// `geography`; inserts cast via ST_SetSRID/ST_MakePoint and all queries
// are SRID-agnostic at the function level.
const geographyPoint = customType<{ data: string; driverData: string }>({
	dataType: () => 'geography'
});

// ─── Supabase-managed auth schema (referenced, never managed by us) ───────
const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
	id: uuid('id').primaryKey()
});

// ─── Couple ───────────────────────────────────────────────────────────────
// Two-person bond. Cardinality enforced via the (partner_a < partner_b)
// check + unique pair index so the same pair cannot exist twice and
// self-pairing is impossible.
export const couple = pgTable(
	'couple',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		partnerA: uuid('partner_a')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		partnerB: uuid('partner_b')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		nickname: text('nickname'),
		anniversary: date('anniversary'),
		// 'active' | 'paused' | 'broken'
		status: text('status').notNull().default('active'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		brokenAt: timestamp('broken_at', { withTimezone: true })
	},
	(t) => [
		check('couple_partners_distinct_chk', sql`${t.partnerA} < ${t.partnerB}`),
		uniqueIndex('couple_pair_uq').on(t.partnerA, t.partnerB),
		uniqueIndex('couple_partner_a_active_uq')
			.on(t.partnerA)
			.where(sql`${t.status} = 'active'`),
		uniqueIndex('couple_partner_b_active_uq')
			.on(t.partnerB)
			.where(sql`${t.status} = 'active'`)
	]
);

// ─── Pairing link code ────────────────────────────────────────────────────
export const linkCode = pgTable(
	'link_code',
	{
		code: text('code').primaryKey(),
		issuerId: uuid('issuer_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true }),
		consumedBy: uuid('consumed_by').references(() => authUsers.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		index('link_code_issuer_idx').on(t.issuerId),
		index('link_code_expires_idx').on(t.expiresAt)
	]
);

// ─── User profile (DuoSync-specific fields) ───────────────────────────────
// 1:1 extension of auth.users. The PK IS the auth uid, so RLS policies
// can use auth.uid() directly without joins.
export const profile = pgTable('profile', {
	userId: uuid('user_id')
		.primaryKey()
		.references(() => authUsers.id, { onDelete: 'cascade' }),
	displayName: text('display_name'),
	pronouns: text('pronouns'),
	avatarUrl: text('avatar_url'),
	avatarEmoji: text('avatar_emoji'),
	onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
	// H4: when set, the account is in a 7-day soft-delete window. Sign-in
	// during the window cancels the deletion. After expiry the hook signs
	// the user out + a separate scheduled job hard-deletes the row.
	pendingDeletionAt: timestamp('pending_deletion_at', { withTimezone: true }),
	// Ghost mode: when true, partner sees "隱身中" + last-seen instead of distance.
	ghostMode: boolean('ghost_mode').notNull().default(false),
	ghostUntil: timestamp('ghost_until', { withTimezone: true })
});

// ─── Location ping ────────────────────────────────────────────────────────
export const locationPing = pgTable(
	'location_ping',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		lat: doublePrecision('lat').notNull(),
		lon: doublePrecision('lon').notNull(),
		geog: geographyPoint('geog').notNull(),
		accuracyM: doublePrecision('accuracy_m'),
		batteryPct: integer('battery_pct'),
		charging: boolean('charging'),
		headingDeg: doublePrecision('heading_deg'),
		speedMps: doublePrecision('speed_mps'),
		capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
		receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		index('location_ping_user_captured_idx').on(t.userId, t.capturedAt.desc()),
		index('location_ping_couple_captured_idx').on(t.coupleId, t.capturedAt.desc())
	]
);

// ─── Location daily summary ───────────────────────────────────────────────
export const locationDailySummary = pgTable(
	'location_daily_summary',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		day: date('day').notNull(),
		pingCount: integer('ping_count').notNull().default(0),
		firstLat: doublePrecision('first_lat'),
		firstLon: doublePrecision('first_lon'),
		lastLat: doublePrecision('last_lat'),
		lastLon: doublePrecision('last_lon'),
		distanceTraveledM: doublePrecision('distance_traveled_m').notNull().default(0)
	},
	(t) => [
		uniqueIndex('location_daily_summary_pk').on(t.userId, t.day),
		index('location_daily_summary_couple_day_idx').on(t.coupleId, t.day.desc())
	]
);

// ─── Relations ────────────────────────────────────────────────────────────
// Note: no relations() entries pointing into authUsers since drizzle-orm
// relation queries don't traverse cross-schema FKs reliably. Joins to
// auth.users are written by hand when needed.
export const coupleRelations = relations(couple, ({ many }) => ({
	pings: many(locationPing)
}));

export const locationPingRelations = relations(locationPing, ({ one }) => ({
	couple: one(couple, { fields: [locationPing.coupleId], references: [couple.id] })
}));

// ─── Geo-Moment ───────────────────────────────────────────────────────────
// A short note dropped at a location. The metadata (lat/lon/radius) is
// visible to both partners, but the body lives in `geo_moment_body` and
// is only readable by the author or by the partner who has walked into
// the radius (server marks `unlocked_by`). See drizzle/manual/0004 +
// docs/rls-model.md.
export const geoMoment = pgTable(
	'geo_moment',
	{
		id: uuid('id')
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		authorId: uuid('author_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		lat: doublePrecision('lat').notNull(),
		lon: doublePrecision('lon').notNull(),
		geog: geographyPoint('geog')
			.notNull()
			.generatedAlwaysAs(sql`st_setsrid(st_makepoint(lon, lat), 4326)::geography`),
		radiusM: integer('radius_m').notNull().default(100),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		unlockedAt: timestamp('unlocked_at', { withTimezone: true }),
		unlockedBy: uuid('unlocked_by').references(() => authUsers.id, { onDelete: 'set null' })
	},
	(t) => [index('geo_moment_couple_created_idx').on(t.coupleId, t.createdAt.desc())]
);

export const geoMomentBody = pgTable('geo_moment_body', {
	momentId: uuid('moment_id')
		.primaryKey()
		.references(() => geoMoment.id, { onDelete: 'cascade' }),
	body: text('body').notNull()
});

export const geoMomentRelations = relations(geoMoment, ({ one }) => ({
	couple: one(couple, { fields: [geoMoment.coupleId], references: [couple.id] }),
	body: one(geoMomentBody, {
		fields: [geoMoment.id],
		references: [geoMomentBody.momentId]
	})
}));

// ─── Daily Question (M8) ────────────────────────────────────────────────
export const dailyQuestion = pgTable('daily_question', {
	id: uuid('id').primaryKey().defaultRandom(),
	promptEn: text('prompt_en').notNull(),
	promptZh: text('prompt_zh'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	active: boolean('active').notNull().default(true)
});

export const dailyQuestionAnswer = pgTable(
	'daily_question_answer',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		questionId: uuid('question_id')
			.notNull()
			.references(() => dailyQuestion.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		uniqueIndex('daily_qa_unique').on(t.coupleId, t.questionId, t.userId),
		index('daily_qa_couple_q_idx').on(t.coupleId, t.questionId)
	]
);

// ─── Push subscriptions (N1) ────────────────────────────────────────────
// One row per browser/device subscription. The endpoint URL is unique per
// subscription so it doubles as the natural key. p256dh/auth are the
// Web Push body-encryption keys. RLS: only the owning user can SELECT or
// DELETE; the delivery worker uses the service-role to read across users.
export const pushSubscription = pgTable(
	'push_subscription',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		userAgent: text('user_agent'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		uniqueIndex('push_subscription_endpoint_idx').on(t.endpoint),
		index('push_subscription_user_idx').on(t.userId)
	]
);

// ─── Push outbox (N2 → N3) ──────────────────────────────────────────────
// Trigger code (location ping, moment drop, …) inserts a row here; the
// N3 delivery worker is the sole consumer. We model it as a queue rather
// than calling web-push synchronously so the SvelteKit Worker stays cold-
// start friendly and so retries / dedupe can be moved into a dedicated
// worker without a public-API change.
//
// `kind` mirrors the trigger taxonomy from N-series planning notes (N2):
//   - 'partner_arrived' — partner entered a saved place radius
//   - 'partner_dropped_moment' — partner authored a moment near you
//   - 'partner_low_battery' — partner crossed 15% on this ping
// `dedupe_key` lets us skip re-enqueueing the same logical event
// (e.g. consecutive low-battery pings) within a window.
export const pushOutbox = pgTable(
	'push_outbox',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		recipientId: uuid('recipient_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		title: text('title').notNull(),
		body: text('body').notNull(),
		dataJson: text('data_json'),
		dedupeKey: text('dedupe_key'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		deliveredAt: timestamp('delivered_at', { withTimezone: true }),
		attempts: integer('attempts').notNull().default(0),
		lastError: text('last_error')
	},
	(t) => [
		index('push_outbox_pending_idx').on(t.createdAt),
		uniqueIndex('push_outbox_dedupe_idx').on(t.recipientId, t.dedupeKey)
	]
);

// H5 audit log — see 0011_audit_log.sql for RLS rationale. Append-only,
// readable only by the acting user. `action` follows a dotted taxonomy:
//   - 'ghost.enable' / 'ghost.disable'
//   - 'unpair.request'
//   - 'account.delete.request' / 'account.delete.cancel'
// `metadata` is freeform JSON for action-specific context (e.g.
// `{ "untilMs": 1234567890 }` for timed ghost).
export const auditLog = pgTable(
	'audit_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		action: text('action').notNull(),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [index('audit_log_user_idx').on(t.userId, t.createdAt)]
);

// F5 mood pulse — append-only mood log. See 0012_mood_pulse.sql for the
// RLS rationale: the partner cannot read the other partner's mood history
// via supabase-js (anti-coercion). Latest-per-couple is delivered to the
// client through SSR page data, which uses Drizzle (RLS-bypassing).
//
// `mood` enum: 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset'.
// The 5 buckets map 1:1 to emoji 😄😊😐😔😢 in the UI.
export const moodPulse = pgTable(
	'mood_pulse',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		mood: text('mood').notNull(),
		setAt: timestamp('set_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		check('mood_pulse_mood_chk', sql`${t.mood} in ('joyful','happy','neutral','sad','upset')`),
		index('mood_pulse_couple_user_idx').on(t.coupleId, t.userId, t.setAt),
		index('mood_pulse_user_idx').on(t.userId, t.setAt)
	]
);

// ─── F3 Scheduled notes (time capsule) ────────────────────────────────────
// Author writes a private note that becomes visible to the partner only
// after `deliver_at`. Cron drains due rows atomically (UPDATE … RETURNING
// + INSERT INTO push_outbox in one CTE — see services/scheduledNotes.ts).
// RLS in drizzle/manual/0013 hides pending notes from the partner so the
// surprise stays a surprise.
export const scheduledNotes = pgTable(
	'scheduled_notes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		authorId: uuid('author_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		deliverAt: timestamp('deliver_at', { withTimezone: true }).notNull(),
		deliveredAt: timestamp('delivered_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		check('scheduled_notes_body_len', sql`char_length(${t.body}) between 1 and 2000`),
		check('scheduled_notes_deliver_future', sql`${t.deliverAt} > ${t.createdAt}`),
		index('scheduled_notes_author_idx').on(t.authorId, t.deliverAt),
		index('scheduled_notes_couple_delivered_idx').on(t.coupleId, t.deliveredAt),
		index('scheduled_notes_due_idx').on(t.deliverAt)
	]
);

// F6 — Shared bucket list. Couple-collaborative wishlist; either
// partner may CRUD any item in their couple. done_at + done_by record
// the celebrating user (CHECK enforces both-or-neither).
export const bucketItems = pgTable(
	'bucket_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		notes: text('notes'),
		targetDate: date('target_date'),
		doneAt: timestamp('done_at', { withTimezone: true }),
		doneBy: uuid('done_by').references(() => authUsers.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date())
	},
	(t) => [
		check('bucket_items_title_len', sql`char_length(${t.title}) between 1 and 200`),
		check('bucket_items_notes_len', sql`${t.notes} is null or char_length(${t.notes}) <= 2000`),
		check('bucket_items_done_pair', sql`(${t.doneAt} is null) = (${t.doneBy} is null)`),
		index('bucket_items_couple_idx').on(t.coupleId, t.doneAt, t.createdAt)
	]
);

// F8 — Shared calendar (v1). Couple-collaborative events. v1 ships
// single-occurrence CRUD; the `rrule` column is reserved for v2
// recurrence expansion via rrule.js. Reminder cron (24h + 1h push)
// is also v2.
export const calendarEvents = pgTable(
	'calendar_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		notes: text('notes'),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		allDay: boolean('all_day').notNull().default(false),
		rrule: text('rrule'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date())
	},
	(t) => [
		check('calendar_events_title_len', sql`char_length(${t.title}) between 1 and 200`),
		check('calendar_events_notes_len', sql`${t.notes} is null or char_length(${t.notes}) <= 2000`),
		check(
			'calendar_events_ends_after_starts',
			sql`${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}`
		),
		index('calendar_events_couple_starts_idx').on(t.coupleId, t.startsAt)
	]
);

// F8 v2 — per-occurrence reminders. Composite PK lets ON CONFLICT
// dedupe a re-population of the same (event, occurrence, kind). See
// drizzle/manual/0018_calendar_reminders.sql for RLS + cron details.
export const calendarReminders = pgTable(
	'calendar_reminders',
	{
		eventId: uuid('event_id')
			.notNull()
			.references(() => calendarEvents.id, { onDelete: 'cascade' }),
		occurrenceAt: timestamp('occurrence_at', { withTimezone: true }).notNull(),
		kind: text('kind').notNull(),
		fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.eventId, t.occurrenceAt, t.kind] }),
		check('calendar_reminders_kind_chk', sql`${t.kind} in ('h24', 'h1')`),
		index('calendar_reminders_pending_idx')
			.on(t.fireAt)
			.where(sql`${t.sentAt} is null`)
	]
);

// F9 — "How well do you know me?" quiz runs. See drizzle/manual/0017
// for the full RLS / semantics rationale. Newlywed-Game shape: each
// partner records both a self_answer (truth) and a guess_answer
// (about the other) per question. Drafts persist; reveal triggers
// only when both a_completed_at and b_completed_at are set.
export const quizRuns = pgTable(
	'quiz_runs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		quizId: text('quiz_id').notNull(),
		startedBy: uuid('started_by')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		aUserId: uuid('a_user_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		bUserId: uuid('b_user_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		aSelfAnswers: jsonb('a_self_answers').$type<Record<string, number>>(),
		aGuessAnswers: jsonb('a_guess_answers').$type<Record<string, number>>(),
		bSelfAnswers: jsonb('b_self_answers').$type<Record<string, number>>(),
		bGuessAnswers: jsonb('b_guess_answers').$type<Record<string, number>>(),
		aCompletedAt: timestamp('a_completed_at', { withTimezone: true }),
		bCompletedAt: timestamp('b_completed_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date())
	},
	(t) => [
		check('quiz_runs_quiz_id_shape', sql`${t.quizId} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
		check('quiz_runs_partners_distinct', sql`${t.aUserId} <> ${t.bUserId}`),
		check('quiz_runs_started_by_member', sql`${t.startedBy} in (${t.aUserId}, ${t.bUserId})`),
		check(
			'quiz_runs_completion_consistent',
			sql`${t.completedAt} is null or (${t.aCompletedAt} is not null and ${t.bCompletedAt} is not null)`
		),
		check('quiz_runs_terminal_state', sql`${t.completedAt} is null or ${t.abandonedAt} is null`),
		index('quiz_runs_couple_idx').on(
			t.coupleId,
			sql`${t.completedAt} desc nulls first`,
			sql`${t.createdAt} desc`
		)
	]
);

// F16 — Repair sessions (post-conflict cooldown + reflection). See
// drizzle/manual/0019_repair_sessions.sql for the lifecycle and RLS
// rationale. One active session per couple at a time (partial unique
// index in the migration).
export const repairSessions = pgTable(
	'repair_sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		initiatorId: uuid('initiator_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		// 'cooldown' | 'reflecting' | 'completed' | 'cancelled'
		status: text('status').notNull().default('cooldown'),
		coolOffUntil: timestamp('cool_off_until', { withTimezone: true }).notNull(),
		initiatorNote: text('initiator_note'),
		partnerId: uuid('partner_id').references(() => authUsers.id, { onDelete: 'set null' }),
		partnerJoinedAt: timestamp('partner_joined_at', { withTimezone: true }),
		partnerNote: text('partner_note'),
		commitmentNote: text('commitment_note'),
		ephemeral: boolean('ephemeral').notNull().default(false),
		startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true })
	},
	(t) => [
		check(
			'repair_sessions_status_chk',
			sql`${t.status} in ('cooldown', 'reflecting', 'completed', 'cancelled')`
		),
		check(
			'repair_sessions_initiator_note_len',
			sql`${t.initiatorNote} is null or char_length(${t.initiatorNote}) <= 1000`
		),
		check(
			'repair_sessions_partner_note_len',
			sql`${t.partnerNote} is null or char_length(${t.partnerNote}) <= 1000`
		),
		check(
			'repair_sessions_commitment_note_len',
			sql`${t.commitmentNote} is null or char_length(${t.commitmentNote}) <= 1000`
		),
		index('repair_sessions_couple_started_idx').on(t.coupleId, t.startedAt.desc())
	]
);

// F7 — couple-only chat messages (text, 7-day TTL). See
// drizzle/manual/0020_chat_messages.sql for RLS + retention policy and
// 0021_chat_messages_purge_cron.sql for the hourly cron purge.
export const chatMessages = pgTable(
	'chat_messages',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		senderId: uuid('sender_id')
			.notNull()
			.references(() => authUsers.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		check('chat_messages_body_len', sql`char_length(${t.body}) between 1 and 2000`),
		index('chat_messages_couple_created_idx').on(t.coupleId, t.createdAt.desc(), t.id.desc())
	]
);

// ─── Pet system (Phase 1, migration 0022_pet.sql) ─────────────────────────
// Shared virtual pet — see pet-system.md for the full design. Drizzle table
// objects mirror the SQL exactly; the manual migration is the source of
// truth for indexes/constraints/RLS.

export const pet = pgTable(
	'pet',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		species: text('species').notNull(),
		name: text('name').notNull(),
		stage: text('stage').notNull().default('egg'),
		xp: integer('xp').notNull().default(0),
		mood: integer('mood').notNull().default(80),
		hunger: integer('hunger').notNull().default(20),
		moodUpdatedAt: timestamp('mood_updated_at', { withTimezone: true }).notNull().defaultNow(),
		hungerUpdatedAt: timestamp('hunger_updated_at', { withTimezone: true }).notNull().defaultNow(),
		// I2: optimistic concurrency. Every write asserts version match
		// and bumps it; mismatched writes retry up to 3× then fail soft.
		version: integer('version').notNull().default(0),
		hatchedAt: timestamp('hatched_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('pet_couple_uq').on(t.coupleId),
		check('pet_species_chk', sql`${t.species} in ('fox','cat','bird','capybara')`),
		check('pet_stage_chk', sql`${t.stage} in ('egg','baby','grown')`),
		check('pet_xp_chk', sql`${t.xp} >= 0`),
		check('pet_mood_chk', sql`${t.mood} between 0 and 100`),
		check('pet_hunger_chk', sql`${t.hunger} between 0 and 100`),
		check('pet_name_len_chk', sql`char_length(${t.name}) between 1 and 24`)
	]
);

export const petWallet = pgTable(
	'pet_wallet',
	{
		coupleId: uuid('couple_id')
			.primaryKey()
			.references(() => couple.id, { onDelete: 'cascade' }),
		coins: integer('coins').notNull().default(0),
		lifetimeEarned: integer('lifetime_earned').notNull().default(0),
		version: integer('version').notNull().default(0),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [check('pet_wallet_coins_chk', sql`${t.coins} >= 0`)]
);

// Append-only ledger of every coin/XP grant + spend. Unique on
// (couple_id, dedupe_key) WHERE dedupe_key IS NOT NULL — partial index
// matched via Drizzle's `targetWhere` on ON CONFLICT (B3).
export const petLedger = pgTable(
	'pet_ledger',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
		kind: text('kind').notNull(),
		source: text('source').notNull(),
		coinsDelta: integer('coins_delta').notNull(),
		xpDelta: integer('xp_delta').notNull().default(0),
		dedupeKey: text('dedupe_key'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('pet_ledger_dedupe_uq')
			.on(t.coupleId, t.dedupeKey)
			.where(sql`${t.dedupeKey} is not null`),
		index('pet_ledger_couple_created_idx').on(t.coupleId, t.createdAt.desc()),
		check('pet_ledger_kind_chk', sql`${t.kind} in ('earn','spend','adjust')`)
	]
);

// Shop catalogue — seeded data, not user-managed.
export const petShopItem = pgTable(
	'pet_shop_item',
	{
		id: text('id').primaryKey(),
		kind: text('kind').notNull(),
		slot: text('slot'),
		nameKey: text('name_key').notNull(),
		descriptionKey: text('description_key').notNull(),
		priceCoins: integer('price_coins').notNull(),
		minStage: text('min_stage').notNull().default('egg'),
		enabled: boolean('enabled').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [
		check('pet_shop_item_kind_chk', sql`${t.kind} in ('cosmetic','treat','furniture','buff')`),
		check('pet_shop_item_min_stage_chk', sql`${t.minStage} in ('egg','baby','grown')`),
		check('pet_shop_item_price_chk', sql`${t.priceCoins} >= 0`)
	]
);

// Per-couple inventory. `slot` denormalized from petShopItem at insert
// time so the partial unique index below can enforce "one equipped per
// (couple, slot)" without a joined index Postgres can't express (W6).
export const petInventory = pgTable(
	'pet_inventory',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		itemId: text('item_id')
			.notNull()
			.references(() => petShopItem.id),
		slot: text('slot'),
		qty: integer('qty').notNull().default(1),
		equipped: boolean('equipped').notNull().default(false),
		acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('pet_inventory_couple_idx').on(t.coupleId),
		uniqueIndex('pet_inventory_couple_item_uq').on(t.coupleId, t.itemId),
		uniqueIndex('pet_inventory_equipped_slot_uq')
			.on(t.coupleId, t.slot)
			.where(sql`${t.equipped} and ${t.slot} is not null`),
		check('pet_inventory_qty_chk', sql`${t.qty} >= 0`)
	]
);

// Active temporary multiplier buffs (Phase 5). Unique on (couple_id,
// kind) so re-activating the same buff EXTENDS active_until rather
// than stacking — the multiplier cap (×2.0) lives in service code.
// Kinds: 'coin' (multiplies coin earns), 'xp' (multiplies XP earns —
// v1 has no XP system, so service refuses activation for now).
export const petBuff = pgTable(
	'pet_buff',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		coupleId: uuid('couple_id')
			.notNull()
			.references(() => couple.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		multiplier: numeric('multiplier', { precision: 3, scale: 2 }).notNull(),
		activeUntil: timestamp('active_until', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('pet_buff_couple_kind_uq').on(t.coupleId, t.kind),
		index('pet_buff_active_until_idx').on(t.activeUntil),
		check('pet_buff_kind_chk', sql`${t.kind} in ('coin','xp')`),
		check('pet_buff_multiplier_chk', sql`${t.multiplier} > 1.0 and ${t.multiplier} <= 2.0`)
	]
);
