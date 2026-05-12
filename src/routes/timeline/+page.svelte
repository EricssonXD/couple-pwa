<!--
  /timeline — full milestone history + upcoming countdowns.

  Pure derive route: reads anniversary (or coupleSince fallback) and renders
  past + future milestones from the shared milestones helpers. No DB writes,
  no realtime.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import {
		allMilestones,
		pastMilestones,
		futureMilestones,
		nextMilestone,
		dayDiffUTC,
		daysTogether,
		resolveBaseDate,
		type Milestone
	} from '$lib/utils/milestones';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	const baseDate = $derived(resolveBaseDate(data.anniversary, data.coupleSince));
	const today = new Date();
	const milestones = $derived(allMilestones(baseDate));
	const past = $derived(pastMilestones(milestones, today).slice().reverse());
	const future = $derived(futureMilestones(milestones, today));
	const next = $derived(nextMilestone(milestones, today));
	const totalDays = $derived(daysTogether(baseDate, today));

	function fmtDate(d: Date): string {
		return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function label(ms: Milestone): string {
		return ms.kind === 'days'
			? m.anniversary_milestone_days({ n: ms.n })
			: m.anniversary_milestone_years({ n: ms.n });
	}
</script>

<svelte:head>
	<title>{m.timeline_title_tag()}</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-8 pb-24">
	<header class="mb-6">
		<p class="text-xs tracking-[0.2em] text-base-content/60 uppercase">{m.timeline_heading()}</p>
		{#if data.coupleNickname}
			<h1 class="mt-1 text-2xl font-semibold">{data.coupleNickname}</h1>
		{/if}
		<p class="mt-2 text-base-content/80">
			<span class="text-display text-3xl font-semibold">{totalDays.toLocaleString()}</span>
			<span class="text-sm text-base-content/60">{m.anniversary_days_unit()}</span>
		</p>
		<p class="text-xs text-base-content/50">
			{m.timeline_since({ date: fmtDate(baseDate) })}
		</p>
	</header>

	{#if next}
		<section
			class="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-accent/10 p-4"
		>
			<p class="text-[10px] tracking-[0.2em] text-primary uppercase">{m.timeline_next_up()}</p>
			<p class="mt-1 text-lg font-semibold">{label(next)}</p>
			<p class="text-sm text-base-content/70">
				{m.timeline_in_n_days({ n: dayDiffUTC(today, next.date) })}
				· {fmtDate(next.date)}
			</p>
		</section>
	{/if}

	{#if future.length > 0}
		<section class="mb-8">
			<h2 class="mb-3 text-sm font-semibold tracking-wide text-base-content/70">
				{m.timeline_upcoming()}
			</h2>
			<ol class="space-y-2">
				{#each future as ms (ms.kind + ms.n)}
					<li
						class="flex items-center justify-between rounded-xl border border-base-content/5 bg-base-200/60 p-3"
					>
						<div>
							<p class="font-medium">{label(ms)}</p>
							<p class="text-xs text-base-content/60">{fmtDate(ms.date)}</p>
						</div>
						<p class="text-xs font-semibold text-primary">
							{m.timeline_in_n_days({ n: dayDiffUTC(today, ms.date) })}
						</p>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	{#if past.length > 0}
		<section>
			<h2 class="mb-3 text-sm font-semibold tracking-wide text-base-content/70">
				{m.timeline_passed()}
			</h2>
			<ol class="space-y-2">
				{#each past as ms (ms.kind + ms.n)}
					<li class="flex items-center justify-between rounded-xl bg-base-200/40 p-3 opacity-70">
						<div>
							<p class="font-medium">{label(ms)}</p>
							<p class="text-xs text-base-content/60">{fmtDate(ms.date)}</p>
						</div>
						<p class="text-xs text-base-content/50">
							{m.timeline_n_days_ago({ n: -dayDiffUTC(today, ms.date) })}
						</p>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	{#if past.length === 0 && future.length === 0}
		<p class="text-center text-base-content/60">{m.timeline_empty()}</p>
	{/if}
</main>
