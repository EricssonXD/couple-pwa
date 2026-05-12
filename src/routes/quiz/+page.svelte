<!--
	F9 — Quiz catalog. Browse "How well do you know me?" packs and
	open active runs.
	TODO(i18n): mirror copy into messages/en.json + messages/zh-hant.json
	once the rest of F9 ships and the strings settle.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	function statusLabel(state: 'open' | 'completed' | 'abandoned', viewerSubmitted: boolean) {
		if (state === 'completed') return 'Both finished';
		if (state === 'abandoned') return 'Abandoned';
		return viewerSubmitted ? 'Waiting for partner' : 'In progress';
	}
</script>

<svelte:head>
	<title>Quizzes · DuoSync</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6 p-4">
	<header class="space-y-1">
		<h1 class="text-2xl font-semibold">How well do you know me?</h1>
		<p class="text-sm text-base-content/70">
			Pick a pack — you both answer about yourself AND guess about each other. Reveal your scores
			side-by-side once both finish.
		</p>
	</header>

	<section aria-label="Available packs" class="space-y-3">
		{#each data.catalog as pack (pack.id)}
			<a
				href={resolve('/quiz/[quizId]', { quizId: pack.id })}
				class="block rounded-lg bg-base-200 p-4 transition hover:bg-base-300"
			>
				<div class="flex items-baseline justify-between gap-3">
					<h2 class="text-lg font-medium">{pack.title}</h2>
					<span class="text-xs text-base-content/60">
						{pack.questionCount} question{pack.questionCount === 1 ? '' : 's'}
					</span>
				</div>
				<p class="mt-1 text-sm text-base-content/80">{pack.description}</p>
			</a>
		{/each}
		{#if data.catalog.length === 0}
			<p class="text-sm text-base-content/60">No packs available right now.</p>
		{/if}
	</section>

	{#if data.runs.length > 0}
		<section aria-label="Recent runs" class="space-y-2">
			<h2 class="text-sm font-medium tracking-wide uppercase">Recent runs</h2>
			<ul class="divide-y divide-base-300 rounded-lg border">
				{#each data.runs as run (run.id)}
					<li class="flex items-center justify-between gap-3 p-3">
						<div>
							<div class="font-medium">{run.quizId}</div>
							<div class="text-xs text-base-content/60">
								{statusLabel(run.state, run.viewerSubmitted)}
							</div>
						</div>
						{#if run.state === 'completed'}
							<a class="btn btn-sm" href={resolve('/quiz/run/[runId]/results', { runId: run.id })}>
								See results
							</a>
						{:else}
							<a class="btn btn-sm" href={resolve('/quiz/run/[runId]', { runId: run.id })}>
								Open
							</a>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
