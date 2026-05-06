-- DuoSync — Row Level Security policies. Phase M1. See plan.md §3.
-- Default deny: every table gets RLS ENABLED + FORCE; only the policies
-- below grant access. The `service_role` JWT bypasses RLS automatically;
-- our admin (secret-key) Supabase client uses that role.

-- ─── profile ───────────────────────────────────────────────────────────────
alter table public.profile enable row level security;
alter table public.profile force row level security;

drop policy if exists profile_select_self_or_partner on public.profile;
create policy profile_select_self_or_partner on public.profile
	for select to authenticated
	using (
		user_id = auth.uid()
		or exists (
			select 1 from public.couple c
			where c.status = 'active'
			  and (
				(c.partner_a = auth.uid() and c.partner_b = profile.user_id) or
				(c.partner_b = auth.uid() and c.partner_a = profile.user_id)
			  )
		)
	);

drop policy if exists profile_insert_self on public.profile;
create policy profile_insert_self on public.profile
	for insert to authenticated
	with check (user_id = auth.uid());

drop policy if exists profile_update_self on public.profile;
create policy profile_update_self on public.profile
	for update to authenticated
	using (user_id = auth.uid())
	with check (user_id = auth.uid());

-- ─── couple ────────────────────────────────────────────────────────────────
alter table public.couple enable row level security;
alter table public.couple force row level security;

drop policy if exists couple_select_partner on public.couple;
create policy couple_select_partner on public.couple
	for select to authenticated
	using (partner_a = auth.uid() or partner_b = auth.uid());

drop policy if exists couple_update_partner on public.couple;
create policy couple_update_partner on public.couple
	for update to authenticated
	using (partner_a = auth.uid() or partner_b = auth.uid())
	with check (partner_a = auth.uid() or partner_b = auth.uid());

-- INSERT/DELETE on couple intentionally disallowed for end users; pairing
-- and unpairing run through privileged server endpoints (admin client).

-- ─── link_code ─────────────────────────────────────────────────────────────
alter table public.link_code enable row level security;
alter table public.link_code force row level security;

drop policy if exists link_code_select_issuer on public.link_code;
create policy link_code_select_issuer on public.link_code
	for select to authenticated
	using (issuer_id = auth.uid() or consumed_by = auth.uid());

drop policy if exists link_code_insert_self on public.link_code;
create policy link_code_insert_self on public.link_code
	for insert to authenticated
	with check (issuer_id = auth.uid());

-- Consumption (UPDATE) goes through the admin server client to avoid
-- a second user being able to silently mark a code consumed without
-- the matching couple-creation transaction.

-- ─── location_ping ─────────────────────────────────────────────────────────
alter table public.location_ping enable row level security;
alter table public.location_ping force row level security;

drop policy if exists location_ping_select_couple on public.location_ping;
create policy location_ping_select_couple on public.location_ping
	for select to authenticated
	using (couple_id = app.current_couple_id());

drop policy if exists location_ping_insert_self on public.location_ping;
create policy location_ping_insert_self on public.location_ping
	for insert to authenticated
	with check (
		user_id = auth.uid()
		and couple_id = app.current_couple_id()
	);

-- Pings are an immutable log: no UPDATE/DELETE policy = denied.

-- ─── location_daily_summary ────────────────────────────────────────────────
alter table public.location_daily_summary enable row level security;
alter table public.location_daily_summary force row level security;

drop policy if exists location_daily_select_couple on public.location_daily_summary;
create policy location_daily_select_couple on public.location_daily_summary
	for select to authenticated
	using (couple_id = app.current_couple_id());

-- Inserts/updates run from a backend cron job using the admin client.
