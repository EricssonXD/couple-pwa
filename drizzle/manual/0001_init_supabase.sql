-- DuoSync — initial schema on Supabase Postgres.
-- Manual migration (Phase M1). See plan.md §3.
-- Idempotent so re-running is safe during M1 iteration.

-- ─── Extensions ────────────────────────────────────────────────────────────
create extension if not exists postgis;
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ─── Helper schema for couple lookup function ──────────────────────────────
create schema if not exists app;

-- ─── couple ───────────────────────────────────────────────────────────────
create table if not exists public.couple (
	id            uuid primary key default gen_random_uuid(),
	partner_a     uuid not null references auth.users(id) on delete cascade,
	partner_b     uuid not null references auth.users(id) on delete cascade,
	nickname      text,
	anniversary   date,
	status        text not null default 'active',
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now(),
	broken_at     timestamptz,
	constraint couple_partners_distinct_chk check (partner_a < partner_b)
);
create unique index if not exists couple_pair_uq
	on public.couple (partner_a, partner_b);
create unique index if not exists couple_partner_a_active_uq
	on public.couple (partner_a) where status = 'active';
create unique index if not exists couple_partner_b_active_uq
	on public.couple (partner_b) where status = 'active';

-- ─── link_code ─────────────────────────────────────────────────────────────
create table if not exists public.link_code (
	code          text primary key,
	issuer_id     uuid not null references auth.users(id) on delete cascade,
	expires_at    timestamptz not null,
	used_at       timestamptz,
	consumed_by   uuid references auth.users(id) on delete set null,
	created_at    timestamptz not null default now()
);
create index if not exists link_code_issuer_idx   on public.link_code (issuer_id);
create index if not exists link_code_expires_idx  on public.link_code (expires_at);

-- ─── profile ───────────────────────────────────────────────────────────────
create table if not exists public.profile (
	user_id       uuid primary key references auth.users(id) on delete cascade,
	display_name  text,
	pronouns      text,
	avatar_url    text,
	avatar_emoji  text,
	onboarded_at  timestamptz,
	ghost_mode    boolean not null default false,
	ghost_until   timestamptz
);

-- ─── location_ping ─────────────────────────────────────────────────────────
create table if not exists public.location_ping (
	id            uuid primary key default gen_random_uuid(),
	user_id       uuid not null references auth.users(id) on delete cascade,
	couple_id     uuid not null references public.couple(id) on delete cascade,
	lat           double precision not null,
	lon           double precision not null,
	geog          geography not null,
	accuracy_m    double precision,
	battery_pct   integer,
	charging      boolean,
	heading_deg   double precision,
	speed_mps     double precision,
	captured_at   timestamptz not null,
	received_at   timestamptz not null default now()
);
create index if not exists location_ping_user_captured_idx
	on public.location_ping (user_id, captured_at desc);
create index if not exists location_ping_couple_captured_idx
	on public.location_ping (couple_id, captured_at desc);

-- ─── location_daily_summary ────────────────────────────────────────────────
create table if not exists public.location_daily_summary (
	user_id              uuid not null references auth.users(id) on delete cascade,
	couple_id            uuid not null references public.couple(id) on delete cascade,
	day                  date not null,
	ping_count           integer not null default 0,
	first_lat            double precision,
	first_lon            double precision,
	last_lat             double precision,
	last_lon             double precision,
	distance_traveled_m  double precision not null default 0
);
create unique index if not exists location_daily_summary_pk
	on public.location_daily_summary (user_id, day);
create index if not exists location_daily_summary_couple_day_idx
	on public.location_daily_summary (couple_id, day desc);

-- ─── updated_at trigger for couple ─────────────────────────────────────────
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
	new.updated_at = now();
	return new;
end$$;

drop trigger if exists couple_set_updated_at on public.couple;
create trigger couple_set_updated_at
	before update on public.couple
	for each row execute function app.set_updated_at();

-- ─── current_couple_id() helper for RLS policies ───────────────────────────
create or replace function app.current_couple_id() returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
	select c.id from public.couple c
	where (c.partner_a = auth.uid() or c.partner_b = auth.uid())
	  and c.status = 'active'
	limit 1;
$$;

revoke all on function app.current_couple_id() from public;
grant execute on function app.current_couple_id() to authenticated;
