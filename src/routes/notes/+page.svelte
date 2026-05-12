<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
	import { MAX_BODY_LEN, MIN_LEAD_TIME_MS } from '$lib/scheduledNotes.constants';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let body = $state('');
	let deliverAtLocal = $state(defaultDeliverAt());
	let submitting = $state(false);
	let err = $state<string | null>(null);

	function defaultDeliverAt(): string {
		const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
		// trim to YYYY-MM-DDTHH:mm in local time for <input type="datetime-local">
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	async function submit() {
		const trimmed = body.trim();
		if (!trimmed) return;
		const deliverAt = new Date(deliverAtLocal);
		if (Number.isNaN(deliverAt.getTime())) {
			err = m.notes_error_too_soon();
			return;
		}
		if (deliverAt.getTime() - Date.now() < MIN_LEAD_TIME_MS) {
			err = m.notes_error_too_soon();
			return;
		}
		submitting = true;
		err = null;
		const r = await fetch('/api/scheduled-notes', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ body: trimmed, deliverAt: deliverAt.toISOString() })
		});
		submitting = false;
		if (!r.ok) {
			if (r.status === 429) err = m.notes_error_quota();
			else if (r.status === 400) {
				const j = (await r.json().catch(() => ({}))) as { code?: string };
				err =
					j.code === 'too_soon'
						? m.notes_error_too_soon()
						: m.notes_error_generic({ status: String(r.status) });
			} else err = m.notes_error_generic({ status: String(r.status) });
			return;
		}
		body = '';
		deliverAtLocal = defaultDeliverAt();
		await invalidateAll();
	}

	async function cancel(id: string) {
		if (!confirm(m.notes_cancel_confirm())) return;
		const r = await fetch(`/api/scheduled-notes/${id}`, { method: 'DELETE' });
		if (r.ok) await invalidateAll();
	}

	function fmt(d: Date | string) {
		const dd = typeof d === 'string' ? new Date(d) : d;
		return dd.toLocaleString([], {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>{m.notes_title_tag()}</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-8 pb-24">
	<header class="mb-6">
		<p class="text-xs tracking-wider text-base-content/60 uppercase">{m.notes_settings_link()}</p>
		<h1 class="text-2xl font-semibold">{m.notes_compose_heading()}</h1>
	</header>

	<section class="card bg-base-200/50 shadow">
		<div class="card-body space-y-3 p-5">
			<label class="form-control">
				<div class="label">
					<span class="label-text">{m.notes_body_label()}</span>
					<span class="label-text-alt text-base-content/60">{body.length}/{MAX_BODY_LEN}</span>
				</div>
				<textarea
					bind:value={body}
					maxlength={MAX_BODY_LEN}
					rows={5}
					placeholder={m.notes_body_placeholder()}
					class="textarea-bordered textarea"
				></textarea>
			</label>
			<label class="form-control">
				<div class="label">
					<span class="label-text">{m.notes_deliver_at_label()}</span>
				</div>
				<input type="datetime-local" bind:value={deliverAtLocal} class="input-bordered input" />
			</label>
			{#if err}<p class="text-sm text-error">{err}</p>{/if}
			<button
				class="btn btn-block btn-primary"
				disabled={submitting || !body.trim()}
				onclick={submit}
			>
				{submitting ? m.notes_saving() : m.notes_save()}
			</button>
		</div>
	</section>

	<section class="mt-8">
		<h2 class="mb-3 text-sm font-semibold tracking-wide text-base-content/70 uppercase">
			{m.notes_pending_heading()}
		</h2>
		{#if data.pending.length === 0}
			<p class="text-sm text-base-content/60">{m.notes_pending_empty()}</p>
		{:else}
			<ul class="space-y-2">
				{#each data.pending as n (n.id)}
					<li class="card bg-base-100 shadow-sm">
						<div class="card-body p-4">
							<p class="text-sm whitespace-pre-wrap">{n.body}</p>
							<div class="mt-2 flex items-center justify-between">
								<span class="text-xs text-base-content/60">
									{m.notes_scheduled_for({ when: fmt(n.deliverAt) })}
								</span>
								<button class="btn text-error btn-ghost btn-xs" onclick={() => cancel(n.id)}>
									{m.notes_cancel()}
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
			{m.notes_delivered_heading()}
		</h2>
		{#if data.delivered.length === 0}
			<p class="text-sm text-base-content/60">{m.notes_delivered_empty()}</p>
		{:else}
			<ul class="space-y-2">
				{#each data.delivered as n (n.id)}
					<li class="card bg-gradient-to-br from-primary/5 to-accent/5 shadow-sm">
						<div class="card-body p-4">
							<p class="text-sm whitespace-pre-wrap">{n.body}</p>
							<p class="mt-2 text-xs text-base-content/60">
								{fmt(n.deliveredAt)}{n.authorId === data.viewerId ? ' · you' : ''}
							</p>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>
