<!--
	F9 — Quiz runner.

	Per anti-coercion / H5: we do NOT show partner progress
	(no "they're on question 4", no "they last edited at 3:14pm").
	The only partner state surfaced is:
	  - "still answering" before they finalize
	  - "done — waiting for you" after they do
	Once both finalize, results page handles the reveal.
-->
<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { BackButton } from '$lib/components/duosync';
	import Notice from '$lib/components/ui/Notice.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	// Local working copy of viewer's answers — saved as drafts on
	// debounce, finalized on submit.
	let selfAnswers = $state<Record<string, number>>(
		untrack(() => ({ ...data.run.viewer.selfAnswers }))
	);
	let guessAnswers = $state<Record<string, number>>(
		untrack(() => ({ ...data.run.viewer.guessAnswers }))
	);
	let viewerLocked = $derived(data.run.viewer.completedAt !== null);

	let saving = $state(false);
	let submitting = $state(false);
	let err = $state<string | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	const allAnswered = $derived.by(() => {
		for (const q of data.pack.questions) {
			if (typeof selfAnswers[q.id] !== 'number') return false;
			if (typeof guessAnswers[q.id] !== 'number') return false;
		}
		return true;
	});

	function scheduleSave() {
		if (viewerLocked) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(saveDraft, 600);
	}

	async function saveDraft() {
		if (viewerLocked) return;
		saving = true;
		err = null;
		try {
			const r = await fetch(`/api/quiz/runs/${data.run.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind: 'draft', selfAnswers, guessAnswers })
			});
			if (!r.ok) err = m.quiz_run_save_failed({ status: r.status });
		} catch (e) {
			err = e instanceof Error ? e.message : m.quiz_run_save_failed_generic();
		} finally {
			saving = false;
		}
	}

	async function submit() {
		if (!allAnswered || submitting) return;
		submitting = true;
		err = null;
		const r = await fetch(`/api/quiz/runs/${data.run.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind: 'final', selfAnswers, guessAnswers })
		});
		submitting = false;
		if (!r.ok) {
			err = m.quiz_run_submit_failed({ status: r.status });
			return;
		}
		const body = (await r.json()) as { run: { reveal: unknown | null } };
		if (body.run.reveal) {
			await goto(resolve('/quiz/run/[runId]/results', { runId: data.run.id }));
		} else {
			// Locked our side; refresh so the waiting state shows.
			await invalidateAll();
		}
	}

	async function abandon() {
		if (!confirm(m.quiz_run_abandon_confirm())) return;
		const r = await fetch(`/api/quiz/runs/${data.run.id}`, { method: 'DELETE' });
		if (r.ok) await goto(resolve('/quiz'));
	}
</script>

<svelte:head>
	<title>{data.pack.title} · Quiz · DuoSync</title>
</svelte:head>

<div class="mx-auto max-w-xl space-y-6 p-4">
	<BackButton fallbackHref="/daily" />

	<header class="space-y-1">
		<h1 class="text-2xl font-semibold">{data.pack.title}</h1>
		<p class="text-sm text-base-content/70">{data.pack.description}</p>
	</header>

	{#if viewerLocked}
		<div class="space-y-2 rounded-lg bg-base-200 p-4">
			<p class="font-medium">{m.quiz_run_locked_heading()}</p>
			<p class="text-sm text-base-content/70">
				{m.quiz_run_locked_body()}
			</p>
		</div>
	{:else}
		<p class="text-xs text-base-content/60">
			{saving ? m.quiz_run_saving() : m.quiz_run_autosave_hint()}
		</p>
	{/if}

	<form
		class="space-y-6"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		{#each data.pack.questions as q, idx (q.id)}
			<fieldset class="space-y-3 rounded-lg bg-base-200 p-4" disabled={viewerLocked}>
				<legend class="px-2 text-xs text-base-content/60">
					{m.quiz_run_question_index({ idx: idx + 1, total: data.pack.questions.length })}
				</legend>
				<p class="font-medium">{q.prompt}</p>

				<div class="space-y-2">
					<p class="text-xs tracking-wide text-base-content/80 uppercase">
						{m.quiz_run_self_label()}
					</p>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{#each q.choices as c, ci (ci)}
							<label class="flex cursor-pointer items-center gap-2 rounded bg-base-100 p-2">
								<input
									type="radio"
									name={`self-${q.id}`}
									class="radio"
									checked={selfAnswers[q.id] === ci}
									onchange={() => {
										selfAnswers = { ...selfAnswers, [q.id]: ci };
										scheduleSave();
									}}
								/>
								<span>{c}</span>
							</label>
						{/each}
					</div>
				</div>

				<div class="space-y-2">
					<p class="text-xs tracking-wide text-base-content/80 uppercase">
						{m.quiz_run_guess_label()}
					</p>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{#each q.choices as c, ci (ci)}
							<label class="flex cursor-pointer items-center gap-2 rounded bg-base-100 p-2">
								<input
									type="radio"
									name={`guess-${q.id}`}
									class="radio"
									checked={guessAnswers[q.id] === ci}
									onchange={() => {
										guessAnswers = { ...guessAnswers, [q.id]: ci };
										scheduleSave();
									}}
								/>
								<span>{c}</span>
							</label>
						{/each}
					</div>
				</div>
			</fieldset>
		{/each}

		{#if err}
			<Notice>{err}</Notice>
		{/if}

		{#if !viewerLocked}
			<div class="flex flex-wrap gap-2">
				<PillButton type="submit" class="flex-1" disabled={!allAnswered || submitting}>
					{#if submitting}
						<Spinner />
						{m.quiz_run_submitting()}
					{:else}
						{m.quiz_run_submit_btn()}
					{/if}
				</PillButton>
				<PillButton variant="ghost" type="button" onclick={abandon}>
					{m.quiz_run_abandon_btn()}
				</PillButton>
			</div>
		{/if}
	</form>
</div>
