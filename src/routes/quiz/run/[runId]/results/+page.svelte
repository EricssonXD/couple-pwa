<!--
	F9 — Reveal page. Side-by-side scoring + per-question breakdown.
	Renders only when the projected run carries a non-null `reveal`
	block (server load redirects to runner otherwise).
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import Icon from '$lib/components/ui/Icon.svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';

	const { data }: { data: PageData } = $props();
	const r = $derived(data.run.reveal!);

	function choiceText(qid: string, idx: number): string {
		const q = data.pack.questions.find((q) => q.id === qid);
		return q ? (q.choices[idx] ?? '—') : '—';
	}
</script>

<svelte:head>
	<title>Results · {data.pack.title} · DuoSync</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6 p-4">
	<a class="text-sm underline" href={resolve('/quiz')}>← All packs</a>

	<header class="space-y-1">
		<h1 class="text-2xl font-semibold">{data.pack.title} — results</h1>
		<p class="text-xs text-base-content/60">
			Both finished {new Date(r.completedAt).toLocaleString()}
		</p>
	</header>

	<section class="rounded-lg bg-base-200 p-4">
		<div class="grid grid-cols-2 gap-4 text-center">
			<div>
				<p class="text-xs tracking-wide text-base-content/70 uppercase">You guessed right</p>
				<p class="text-3xl font-semibold">{r.viewerScore} / {r.questionCount}</p>
			</div>
			<div>
				<p class="text-xs tracking-wide text-base-content/70 uppercase">Partner guessed right</p>
				<p class="text-3xl font-semibold">{r.partnerScore} / {r.questionCount}</p>
			</div>
		</div>
	</section>

	<section class="space-y-3">
		<h2 class="text-sm font-medium tracking-wide uppercase">Per-question breakdown</h2>
		{#each data.pack.questions as q (q.id)}
			{@const viewerSelf = r.viewerSelfAnswers[q.id]}
			{@const viewerGuess = r.viewerGuessAnswers[q.id]}
			{@const partnerSelf = r.partnerSelfAnswers[q.id]}
			{@const partnerGuess = r.partnerGuessAnswers[q.id]}
			{@const youGotIt = viewerGuess === partnerSelf}
			{@const partnerGotIt = partnerGuess === viewerSelf}
			<article class="space-y-2 rounded-lg bg-base-200 p-4">
				<p class="font-medium">{q.prompt}</p>
				<div class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
					<div class="rounded bg-base-100 p-2">
						<p class="text-xs text-base-content/60 uppercase">You</p>
						<p>Truth: {choiceText(q.id, viewerSelf)}</p>
						<p class="inline-flex items-center gap-1">
							<span>Your guess about partner: {choiceText(q.id, viewerGuess)}</span>
							<span class={youGotIt ? 'text-success' : 'text-error'}>
								<Icon icon={youGotIt ? CheckIcon : XIcon} size={14} weight="bold" />
							</span>
						</p>
					</div>
					<div class="rounded bg-base-100 p-2">
						<p class="text-xs text-base-content/60 uppercase">Partner</p>
						<p>Truth: {choiceText(q.id, partnerSelf)}</p>
						<p class="inline-flex items-center gap-1">
							<span>Their guess about you: {choiceText(q.id, partnerGuess)}</span>
							<span class={partnerGotIt ? 'text-success' : 'text-error'}>
								<Icon icon={partnerGotIt ? CheckIcon : XIcon} size={14} weight="bold" />
							</span>
						</p>
					</div>
				</div>
			</article>
		{/each}
	</section>

	<div class="flex gap-2">
		<a class="btn flex-1" href={resolve('/quiz/[quizId]', { quizId: data.run.quizId })}
			>Play again</a
		>
		<a class="btn btn-ghost" href={resolve('/quiz')}>More packs</a>
	</div>
</div>
