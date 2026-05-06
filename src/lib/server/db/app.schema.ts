import { relations } from 'drizzle-orm';
import {
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
	customType
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.schema';

// PostGIS geography point (SRID 4326). Drizzle-kit's push has trouble with the
// `geography(Point, 4326)` typmod form, so we declare the column as plain
// `geography` and rely on inserts that explicitly cast via ST_SetSRID/ST_MakePoint.
// All our ST_* queries are SRID-agnostic at the function level.
const geographyPoint = customType<{ data: string; driverData: string }>({
	dataType: () => 'geography'
});

// ─── Couple ───────────────────────────────────────────────────────────────
// Two-person bond. Cardinality enforced at the application layer AND via the
// (partner_a < partner_b) check + unique pair index so the same pair cannot
// exist twice and self-pairing is impossible.
export const couple = pgTable(
	'couple',
	{
		id: text('id')
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		partnerA: text('partner_a')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		partnerB: text('partner_b')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
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
		// Each user may only be in one ACTIVE couple at a time. A partial unique
		// index per role enforces this without blocking historical rows.
		uniqueIndex('couple_partner_a_active_uq')
			.on(t.partnerA)
			.where(sql`${t.status} = 'active'`),
		uniqueIndex('couple_partner_b_active_uq')
			.on(t.partnerB)
			.where(sql`${t.status} = 'active'`)
	]
);

// ─── Pairing link code ────────────────────────────────────────────────────
// Single-use, short-TTL code issued by partner A so partner B can join.
export const linkCode = pgTable(
	'link_code',
	{
		code: text('code').primaryKey(),
		issuerId: text('issuer_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true }),
		consumedBy: text('consumed_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		index('link_code_issuer_idx').on(t.issuerId),
		index('link_code_expires_idx').on(t.expiresAt)
	]
);

// ─── User profile (DuoSync-specific fields) ───────────────────────────────
// Lives separate from Better-Auth's user table so we never hand-edit the
// generated auth schema. Joined 1:1 by userId.
export const profile = pgTable('profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	displayName: text('display_name'),
	pronouns: text('pronouns'),
	avatarUrl: text('avatar_url'),
	avatarEmoji: text('avatar_emoji'),
	onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
	// Ghost mode: when true, partner sees "隱身中" + last-seen instead of distance.
	// ghostUntil lets users schedule auto-expiry (e.g. "ghost for 1 hour").
	ghostMode: boolean('ghost_mode').notNull().default(false),
	ghostUntil: timestamp('ghost_until', { withTimezone: true })
});

// ─── Location ping ────────────────────────────────────────────────────────
// One row per accepted client report. Server enforces minimum interval +
// movement threshold to keep the table small. Geography column powers
// ST_Distance; lat/lon kept as cheap reads for non-spatial paths.
export const locationPing = pgTable(
	'location_ping',
	{
		id: text('id')
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		coupleId: text('couple_id')
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
// After 7d, raw pings are pruned; this row preserves coarse history for
// future "memory resurface" / yearly heatmaps without keeping every fix.
export const locationDailySummary = pgTable(
	'location_daily_summary',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		coupleId: text('couple_id')
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
export const coupleRelations = relations(couple, ({ one }) => ({
	partnerAUser: one(user, { fields: [couple.partnerA], references: [user.id], relationName: 'a' }),
	partnerBUser: one(user, { fields: [couple.partnerB], references: [user.id], relationName: 'b' })
}));

export const linkCodeRelations = relations(linkCode, ({ one }) => ({
	issuer: one(user, { fields: [linkCode.issuerId], references: [user.id] })
}));

export const profileRelations = relations(profile, ({ one }) => ({
	user: one(user, { fields: [profile.userId], references: [user.id] })
}));

export const locationPingRelations = relations(locationPing, ({ one }) => ({
	user: one(user, { fields: [locationPing.userId], references: [user.id] }),
	couple: one(couple, { fields: [locationPing.coupleId], references: [couple.id] })
}));
