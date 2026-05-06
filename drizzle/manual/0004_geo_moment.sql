-- DuoSync — Phase Moments (M7).
-- Geo-moments: short notes a partner drops at a location; the other partner
-- has to walk into the radius to read the body.
--
-- Trust model (see docs/rls-model.md):
--   • Bodies live in a SEPARATE table (geo_moment_body) so RLS, not endpoint
--     code, gates "walk closer to read".
--   • All writes go through the server (admin client / service_role bypass).
--     End users have NO direct INSERT/UPDATE/DELETE policies on either table.
--   • SELECT on the body table requires (author OR unlocked_by = auth.uid()).
--
-- Idempotent so re-running is safe during M7 iteration.

-- ─── geo_moment (metadata, freely visible to couple members) ─────────────
create table if not exists public.geo_moment (
	id            uuid primary key default gen_random_uuid(),
	couple_id     uuid not null references public.couple(id) on delete cascade,
	author_id     uuid not null references auth.users(id) on delete cascade,
	lat           double precision not null,
	lon           double precision not null,
	geog          geography(Point, 4326) generated always as (
		st_setsrid(st_makepoint(lon, lat), 4326)::geography
	) stored,
	radius_m      integer not null default 100,
	created_at    timestamptz not null default now(),
	expires_at    timestamptz,
	deleted_at    timestamptz,
	unlocked_at   timestamptz,
	unlocked_by   uuid references auth.users(id) on delete set null,
	constraint geo_moment_lat_chk check (lat between -90 and 90),
	constraint geo_moment_lon_chk check (lon between -180 and 180),
	constraint geo_moment_radius_chk check (radius_m between 50 and 1000),
	constraint geo_moment_unlock_consistent_chk check (
		(unlocked_at is null and unlocked_by is null)
		or (unlocked_at is not null and unlocked_by is not null)
	),
	constraint geo_moment_unlock_not_self_chk check (
		unlocked_by is null or unlocked_by <> author_id
	)
);

create index if not exists geo_moment_couple_created_idx
	on public.geo_moment (couple_id, created_at desc);
create index if not exists geo_moment_locked_geog_gist
	on public.geo_moment using gist (geog)
	where unlocked_at is null and deleted_at is null;
create index if not exists geo_moment_locked_couple_idx
	on public.geo_moment (couple_id, created_at desc)
	where unlocked_at is null and deleted_at is null;
create index if not exists geo_moment_expires_idx
	on public.geo_moment (expires_at)
	where expires_at is not null and deleted_at is null;

-- ─── geo_moment_body (the "secret" — readable only by author or unlocker) ─
create table if not exists public.geo_moment_body (
	moment_id     uuid primary key references public.geo_moment(id) on delete cascade,
	body          text not null,
	constraint geo_moment_body_len_chk check (char_length(body) between 1 and 280)
);

-- ─── RLS — geo_moment ────────────────────────────────────────────────────
alter table public.geo_moment enable row level security;
alter table public.geo_moment force row level security;

drop policy if exists geo_moment_select_couple on public.geo_moment;
create policy geo_moment_select_couple on public.geo_moment
	for select to authenticated
	using (
		deleted_at is null
		and couple_id = app.current_couple_id()
	);

-- INSERT/UPDATE/DELETE intentionally absent: server-only via admin client.

-- ─── RLS — geo_moment_body ───────────────────────────────────────────────
alter table public.geo_moment_body enable row level security;
alter table public.geo_moment_body force row level security;

drop policy if exists geo_moment_body_select_visible on public.geo_moment_body;
create policy geo_moment_body_select_visible on public.geo_moment_body
	for select to authenticated
	using (
		exists (
			select 1
			from public.geo_moment gm
			where gm.id = geo_moment_body.moment_id
			  and gm.deleted_at is null
			  and gm.couple_id = app.current_couple_id()
			  and (gm.author_id = auth.uid() or gm.unlocked_by = auth.uid())
		)
	);
