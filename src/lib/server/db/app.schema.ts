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
	text,
	timestamp,
	date,
	uniqueIndex,
	index,
	check,
	doublePrecision,
	integer,
	boolean,
	uuid,
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
// `kind` mirrors the trigger taxonomy in docs/next-phases.md (N2):
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
