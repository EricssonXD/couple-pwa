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
id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
coupleId: uuid('couple_id')
.notNull()
.references(() => couple.id, { onDelete: 'cascade' }),
authorId: uuid('author_id')
.notNull()
.references(() => authUsers.id, { onDelete: 'cascade' }),
lat: doublePrecision('lat').notNull(),
lon: doublePrecision('lon').notNull(),
geog: geographyPoint('geog').notNull(),
radiusM: integer('radius_m').notNull().default(100),
createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
expiresAt: timestamp('expires_at', { withTimezone: true }),
deletedAt: timestamp('deleted_at', { withTimezone: true }),
unlockedAt: timestamp('unlocked_at', { withTimezone: true }),
unlockedBy: uuid('unlocked_by').references(() => authUsers.id, { onDelete: 'set null' })
},
(t) => [
index('geo_moment_couple_created_idx').on(t.coupleId, t.createdAt.desc())
]
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
