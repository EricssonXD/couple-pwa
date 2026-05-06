-- DuoSync — Daily Question (M8).
--
-- A small ritual: each day a curated prompt appears for both partners.
-- Each writes a short answer privately. Once both have answered, the
-- partner's answer is revealed.
--
-- Trust model:
--   • daily_question is a public read-only catalog (anyone authed can read).
--   • daily_question_answer rows are written by users for themselves only.
--   • SELECT policy: own rows always; partner's row only AFTER both have
--     answered for the same (couple_id, question_id) pair.
--
-- Idempotent.

-- ─── catalog of curated prompts ──────────────────────────────────────────
create table if not exists public.daily_question (
	id          uuid primary key default gen_random_uuid(),
	prompt_en   text not null,
	prompt_zh   text,
	created_at  timestamptz not null default now(),
	active      boolean not null default true
);

alter table public.daily_question enable row level security;

drop policy if exists "daily_question read for authed" on public.daily_question;
create policy "daily_question read for authed" on public.daily_question
	for select to authenticated
	using (active = true);

-- ─── answers ─────────────────────────────────────────────────────────────
create table if not exists public.daily_question_answer (
	id              uuid primary key default gen_random_uuid(),
	couple_id       uuid not null references public.couple(id) on delete cascade,
	question_id     uuid not null references public.daily_question(id) on delete cascade,
	user_id         uuid not null references auth.users(id) on delete cascade,
	body            text not null,
	created_at      timestamptz not null default now(),
	-- one answer per user per question per couple
	constraint daily_qa_unique unique (couple_id, question_id, user_id),
	constraint daily_qa_body_chk check (char_length(body) between 1 and 1000)
);

create index if not exists daily_qa_couple_q_idx
	on public.daily_question_answer (couple_id, question_id);

alter table public.daily_question_answer enable row level security;

-- SELECT own row.
drop policy if exists "daily_qa select own" on public.daily_question_answer;
create policy "daily_qa select own" on public.daily_question_answer
	for select to authenticated
	using (user_id = auth.uid());

-- SELECT partner row only after viewer has also answered.
drop policy if exists "daily_qa select partner after both answered" on public.daily_question_answer;
create policy "daily_qa select partner after both answered" on public.daily_question_answer
	for select to authenticated
	using (
		exists (
			select 1
			from public.couple c
			where c.id = daily_question_answer.couple_id
				and (c.partner_a = auth.uid() or c.partner_b = auth.uid())
				and c.status = 'active'
		)
		and exists (
			select 1
			from public.daily_question_answer me
			where me.couple_id = daily_question_answer.couple_id
				and me.question_id = daily_question_answer.question_id
				and me.user_id = auth.uid()
		)
	);

-- All writes go through the server (admin / service_role bypass RLS).
-- No client INSERT/UPDATE/DELETE policies.
