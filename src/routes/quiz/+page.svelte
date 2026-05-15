<!--
	F9 — Quiz catalog. Browse "How well do you know me?" packs and
	open active runs.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import { HubHeader, todayChips } from '$lib/components/duosync';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	function statusLabel(state: 'open' | 'completed' | 'abandoned', viewerSubmitted: boolean) {
		if (state === 'completed') return m.quiz_status_completed();
		if (state === 'abandoned') return m.quiz_status_abandoned();
		return viewerSubmitted ? m.quiz_status_waiting() : m.quiz_status_in_progress();
	}

	function questionCountLabel(n: number) {
		return n === 1 ? m.quiz_question_count_one() : m.quiz_question_count_other({ n: String(n) });
	}
</script>

<svelte:head>
	<title>{m.quiz_title_tag()}</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-7">
	<HubHeader
		title={m.quiz_heading}
		fallbackHref="/daily"
		chips={todayChips}
		current={page.url.pathname}
	/>
	<div class="space-y-7 px-4">
		<header class="space-y-2">
			<p class="text-sm leading-relaxed text-base-content/70">{m.quiz_subtitle()}</p>
		</header>

		<section aria-label="Available packs" class="space-y-3">
			{#each data.catalog as pack (pack.id)}
				<a
					href={resolve('/quiz/[quizId]', { quizId: pack.id })}
					class="block rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 p-5 shadow-paper transition hover:border-primary/30 hover:shadow-md"
				>
					<div class="flex items-baseline justify-between gap-3">
						<h2 class="text-lg font-semibold">{pack.title}</h2>
						<span class="text-xs tracking-wider text-base-content/55 uppercase">
							{questionCountLabel(pack.questionCount)}
						</span>
					</div>
					<p class="mt-1.5 text-sm leading-relaxed text-base-content/75">{pack.description}</p>
				</a>
			{/each}
			{#if data.catalog.length === 0}
				<p
					class="rounded-[var(--radius-card)] border border-dashed border-base-content/15 px-4 py-8 text-center text-sm text-base-content/55"
				>
					{m.quiz_empty()}
				</p>
			{/if}
		</section>

		{#if data.runs.length > 0}
			<section aria-label="Recent runs" class="space-y-3">
				<h2 class="text-xs font-semibold tracking-wider text-base-content/60 uppercase">
					{m.quiz_recent_runs()}
				</h2>
				<ul
					class="divide-y divide-base-content/5 overflow-hidden rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 shadow-paper"
				>
					{#each data.runs as run (run.id)}
						<li class="flex items-center justify-between gap-3 px-4 py-3">
							<div class="min-w-0">
								<div class="truncate font-medium">{run.quizId}</div>
								<div class="text-xs text-base-content/60">
									{statusLabel(run.state, run.viewerSubmitted)}
								</div>
							</div>
							{#if run.state === 'completed'}
								<a
									class="rounded-full bg-primary px-4 py-1.5 text-[0.7rem] font-semibold tracking-wider text-primary-content uppercase"
									href={resolve('/quiz/run/[runId]/results', { runId: run.id })}
								>
									{m.quiz_see_results()}
								</a>
							{:else}
								<a
									class="rounded-full border border-base-content/15 px-4 py-1.5 text-[0.7rem] font-semibold tracking-wider uppercase hover:border-primary/40 hover:text-primary"
									href={resolve('/quiz/run/[runId]', { runId: run.id })}
								>
									{m.quiz_open()}
								</a>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</div>
