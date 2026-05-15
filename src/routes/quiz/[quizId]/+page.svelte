<!--
	F9 — Pack overview / start screen.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { HubHeader, todayChips } from '$lib/components/duosync';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let starting = $state(false);
	let err = $state<string | null>(null);

	async function start() {
		starting = true;
		err = null;
		const r = await fetch('/api/quiz/runs', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ quizId: data.pack.id })
		});
		starting = false;
		if (!r.ok) {
			err = `Could not start (status ${r.status}).`;
			return;
		}
		const body = (await r.json()) as { runId: string };
		await goto(resolve('/quiz/run/[runId]', { runId: body.runId }));
	}
</script>

<svelte:head>
	<title>{data.pack.title} · Quiz · DuoSync</title>
</svelte:head>

<div class="mx-auto max-w-xl">
	<HubHeader
		title={() => data.pack.title}
		fallbackHref="/daily"
		chips={todayChips}
		current={page.url.pathname}
	/>
	<div class="space-y-6 px-4 pt-2">
		<header class="space-y-2">
			<p class="text-base-content/80">{data.pack.description}</p>
			<p class="text-xs text-base-content/60">
				{data.pack.questionCount} questions · ~3 min each
			</p>
		</header>

		<div class="space-y-2 rounded-lg bg-base-200 p-4 text-sm">
			<p class="font-medium">How it works</p>
			<ol class="list-inside list-decimal space-y-1">
				<li>
					For each question you pick what you'd really choose AND guess what your partner picked.
				</li>
				<li>Your answers stay private until you both finish.</li>
				<li>When the second of you finishes, you'll both see the side-by-side reveal.</li>
			</ol>
		</div>

		{#if err}
			<p class="text-sm text-error" role="alert">{err}</p>
		{/if}

		<button class="btn w-full btn-primary" onclick={start} disabled={starting}>
			{starting ? 'Starting…' : 'Start (or resume) this quiz'}
		</button>
	</div>
</div>
