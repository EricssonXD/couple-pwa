-- DuoSync — Realtime RLS policies. Phase M6. See plan.md §M6.
-- Authorizes couple members to participate in their private `couple:<uuid>`
-- broadcast/presence channel, and crucially DENIES client INSERT on the
-- broadcast extension so a partner can't forge `location_update` /
-- `ghost_change` events. Server fan-out via service-role REST bypasses RLS.

-- The `realtime.messages` table is managed by Supabase. RLS is enabled by
-- default. We add four policies: SELECT broadcast, SELECT presence, INSERT
-- presence, and an explicit absence of INSERT broadcast (= denied).

-- Why no UUID cast: we compare topic text-to-text so a malformed topic
-- such as `couple:not-a-uuid` simply fails to match (no membership) rather
-- than raising `invalid input syntax for type uuid` mid-policy. This also
-- avoids planner-order surprises with `like 'couple:%'` guards.

-- Helper used inside the policies: returns true iff the calling user is a
-- partner of the active couple referenced by the current realtime topic.
create or replace function app.is_couple_topic_member() returns boolean as $$
	select exists (
		select 1
		from public.couple c
		where c.status = 'active'
		  and (select realtime.topic()) = 'couple:' || c.id::text
		  and (c.partner_a = (select auth.uid()) or c.partner_b = (select auth.uid()))
	);
$$ language sql stable security definer set search_path = '';

-- ─── SELECT (read broadcast + presence) ────────────────────────────────────

drop policy if exists "couple members read realtime" on realtime.messages;
create policy "couple members read realtime" on realtime.messages
	for select to authenticated
	using (
		extension in ('broadcast', 'presence')
		and app.is_couple_topic_member()
	);

-- ─── INSERT presence (channel.track) ──────────────────────────────────────
-- Couple members may write their own presence to their topic.

drop policy if exists "couple members write presence" on realtime.messages;
create policy "couple members write presence" on realtime.messages
	for insert to authenticated
	with check (
		extension = 'presence'
		and app.is_couple_topic_member()
	);

-- ─── INSERT broadcast: intentionally DENIED ───────────────────────────────
-- No policy granted. Default-deny applies. All client-originated broadcasts
-- (e.g. heartbeat_tap) must round-trip through a server endpoint that
-- validates the caller and re-broadcasts via the service-role REST endpoint
-- (POST /realtime/v1/api/broadcast), which bypasses RLS.
