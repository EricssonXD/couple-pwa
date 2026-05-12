<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
	import { MAX_TITLE_LEN, MAX_NOTES_LEN } from '$lib/bucketList.constants';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let title = $state('');
	let notes = $state('');
	let targetDate = $state('');
	let submitting = $state(false);
	let err = $state<string | null>(null);

	const pending = $derived(data.items.filter((i) => i.doneAt === null));
	const done = $derived(data.items.filter((i) => i.doneAt !== null));

	async function add() {
		const t = title.trim();
		if (!t) return;
		submitting = true;
		err = null;
		const r = await fetch('/api/bucket', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				title: t,
				notes: notes.trim() || undefined,
				targetDate: targetDate || undefined
			})
		});
		submitting = false;
		if (!r.ok) {
			err =
				r.status === 429
					? m.bucket_error_quota()
					: m.bucket_error_generic({ status: String(r.status) });
			return;
		}
		title = '';
		notes = '';
		targetDate = '';
		await invalidateAll();
	}

	async function toggleDone(id: string, currentlyDone: boolean) {
		const r = await fetch(`/api/bucket/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ done: !currentlyDone })
		});
		if (r.ok) await invalidateAll();
	}

	async function remove(id: string) {
		const r = await fetch(`/api/bucket/${id}`, { method: 'DELETE' });
		if (r.ok) await invalidateAll();
	}

	function fmtDate(d: string | Date | null) {
		if (!d) return '';
		const dd = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
		return dd.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

<svelte:head>
	<title>{m.bucket_title_tag()}</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-8 pb-24">
	<header class="mb-6">
		<p class="text-xs tracking-wider text-base-content/60 uppercase">
			{m.bucket_settings_link()}
		</p>
		<h1 class="text-display text-3xl font-semibold tracking-wide">
			{m.bucket_compose_heading()}
		</h1>
	</header>

	<section
		class="space-y-3 rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 p-5 shadow-paper"
	>
		<label class="form-control">
			<div class="label">
				<span class="label-text">{m.bucket_title_label()}</span>
				<span class="label-text-alt text-base-content/60">{title.length}/{MAX_TITLE_LEN}</span>
			</div>
			<input
				bind:value={title}
				maxlength={MAX_TITLE_LEN}
				placeholder={m.bucket_title_placeholder()}
				class="input-bordered input"
			/>
		</label>
		<label class="form-control">
			<div class="label">
				<span class="label-text">{m.bucket_notes_label()}</span>
				<span class="label-text-alt text-base-content/60">{notes.length}/{MAX_NOTES_LEN}</span>
			</div>
			<textarea
				bind:value={notes}
				maxlength={MAX_NOTES_LEN}
				rows={3}
				placeholder={m.bucket_notes_placeholder()}
				class="textarea-bordered textarea"
			></textarea>
		</label>
		<label class="form-control">
			<div class="label">
				<span class="label-text">{m.bucket_target_date_label()}</span>
			</div>
			<input type="date" bind:value={targetDate} class="input-bordered input" />
		</label>
		{#if err}<p class="text-sm text-error">{err}</p>{/if}
		<button class="btn btn-block btn-primary" disabled={submitting || !title.trim()} onclick={add}>
			{m.bucket_add()}
		</button>
	</section>

	<section class="mt-8">
		<h2 class="mb-3 text-sm font-semibold tracking-wide text-base-content/70 uppercase">
			{m.bucket_pending_heading()}
		</h2>
		{#if pending.length === 0}
			<p class="text-sm text-base-content/60">{m.bucket_empty()}</p>
		{:else}
			<ul class="space-y-2">
				{#each pending as it (it.id)}
					<li class="card bg-base-100 shadow-sm">
						<div class="card-body p-4">
							<div class="flex items-start gap-3">
								<input
									type="checkbox"
									class="checkbox mt-1 checkbox-primary"
									checked={false}
									onchange={() => toggleDone(it.id, false)}
								/>
								<div class="flex-1">
									<p class="font-medium">{it.title}</p>
									{#if it.notes}
										<p class="mt-1 text-sm whitespace-pre-wrap text-base-content/70">{it.notes}</p>
									{/if}
									<div class="mt-2 flex flex-wrap gap-2 text-xs text-base-content/60">
										{#if it.targetDate}<span>📅 {fmtDate(it.targetDate)}</span>{/if}
										<span>
											{it.createdBy === data.viewerId
												? m.bucket_added_by_you()
												: m.bucket_added_by_partner()}
										</span>
									</div>
								</div>
								<button
									class="btn text-error btn-ghost btn-xs"
									onclick={() => remove(it.id)}
									aria-label={m.bucket_remove()}
								>
									✕
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="mt-8">
		<h2 class="mb-3 text-sm font-semibold tracking-wide text-base-content/70 uppercase">
			{m.bucket_done_heading()}
		</h2>
		{#if done.length === 0}
			<p class="text-sm text-base-content/60">{m.bucket_done_empty()}</p>
		{:else}
			<ul class="space-y-2">
				{#each done as it (it.id)}
					<li class="card bg-gradient-to-br from-success/10 to-primary/5 shadow-sm">
						<div class="card-body p-4">
							<div class="flex items-start gap-3">
								<input
									type="checkbox"
									class="checkbox mt-1 checkbox-success"
									checked={true}
									onchange={() => toggleDone(it.id, true)}
								/>
								<div class="flex-1">
									<p class="font-medium line-through opacity-70">{it.title}</p>
									<p class="mt-1 text-xs text-base-content/60">
										{fmtDate(it.doneAt)}
									</p>
								</div>
								<button
									class="btn text-error btn-ghost btn-xs"
									onclick={() => remove(it.id)}
									aria-label={m.bucket_remove()}
								>
									✕
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>
