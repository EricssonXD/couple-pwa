<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
	import { MAX_TITLE_LEN, MAX_NOTES_LEN } from '$lib/calendar.constants';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let title = $state('');
	let notes = $state('');
	let startsAt = $state('');
	let endsAt = $state('');
	let allDay = $state(false);
	let submitting = $state(false);
	let err = $state<string | null>(null);

	type Ev = PageData['events'][number];

	// Group upcoming events by local YYYY-MM-DD.
	const grouped = $derived.by(() => {
		const buckets: Record<string, Ev[]> = {};
		for (const e of data.events) {
			const d = new Date(e.startsAt);
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			(buckets[key] ??= []).push(e);
		}
		return Object.entries(buckets).sort((a, b) => a[0].localeCompare(b[0]));
	});

	function toIsoOrNull(local: string): string | null {
		if (!local) return null;
		// `datetime-local` returns "YYYY-MM-DDTHH:mm" in local time.
		const d = new Date(local);
		return Number.isNaN(d.getTime()) ? null : d.toISOString();
	}

	async function add() {
		const t = title.trim();
		if (!t) return;
		const startIso = toIsoOrNull(startsAt);
		if (!startIso) {
			err = m.calendar_error_starts_at();
			return;
		}
		const endIso = toIsoOrNull(endsAt);
		submitting = true;
		err = null;
		const r = await fetch('/api/events', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				title: t,
				notes: notes.trim() || undefined,
				startsAt: startIso,
				endsAt: endIso ?? undefined,
				allDay
			})
		});
		submitting = false;
		if (!r.ok) {
			err =
				r.status === 429
					? m.calendar_error_quota()
					: m.calendar_error_generic({ status: String(r.status) });
			return;
		}
		title = '';
		notes = '';
		startsAt = '';
		endsAt = '';
		allDay = false;
		await invalidateAll();
	}

	async function remove(id: string) {
		const r = await fetch(`/api/events/${id}`, { method: 'DELETE' });
		if (r.ok) await invalidateAll();
	}

	function fmtDay(key: string) {
		const d = new Date(key + 'T00:00:00');
		return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
	}

	function fmtTime(iso: string) {
		return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>{m.calendar_title_tag()}</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-8 pb-24">
	<header class="mb-6">
		<p class="text-xs tracking-wider text-base-content/60 uppercase">
			{m.calendar_settings_link()}
		</p>
		<h1 class="text-2xl font-semibold">{m.calendar_compose_heading()}</h1>
	</header>

	<section class="card bg-base-200/50 shadow">
		<div class="card-body space-y-3 p-5">
			<label class="form-control">
				<div class="label">
					<span class="label-text">{m.calendar_title_label()}</span>
					<span class="label-text-alt text-base-content/60">{title.length}/{MAX_TITLE_LEN}</span>
				</div>
				<input
					bind:value={title}
					maxlength={MAX_TITLE_LEN}
					placeholder={m.calendar_title_placeholder()}
					class="input-bordered input"
				/>
			</label>
			<label class="form-control">
				<div class="label">
					<span class="label-text">{m.calendar_notes_label()}</span>
					<span class="label-text-alt text-base-content/60">{notes.length}/{MAX_NOTES_LEN}</span>
				</div>
				<textarea
					bind:value={notes}
					maxlength={MAX_NOTES_LEN}
					rows={2}
					placeholder={m.calendar_notes_placeholder()}
					class="textarea-bordered textarea"
				></textarea>
			</label>
			<label class="form-control">
				<div class="label">
					<span class="label-text">{m.calendar_starts_at_label()}</span>
				</div>
				<input type="datetime-local" bind:value={startsAt} class="input-bordered input" />
			</label>
			<label class="form-control">
				<div class="label">
					<span class="label-text">{m.calendar_ends_at_label()}</span>
				</div>
				<input type="datetime-local" bind:value={endsAt} class="input-bordered input" />
			</label>
			<label class="label cursor-pointer justify-start gap-3">
				<input type="checkbox" bind:checked={allDay} class="checkbox checkbox-sm" />
				<span class="label-text">{m.calendar_all_day_label()}</span>
			</label>
			{#if err}<p class="text-sm text-error">{err}</p>{/if}
			<button
				class="btn btn-block btn-primary"
				disabled={submitting || !title.trim() || !startsAt}
				onclick={add}
			>
				{m.calendar_add()}
			</button>
		</div>
	</section>

	<section class="mt-8">
		<h2 class="mb-3 text-sm font-semibold tracking-wide text-base-content/70 uppercase">
			{m.calendar_upcoming_heading()}
		</h2>
		{#if grouped.length === 0}
			<p class="text-sm text-base-content/60">{m.calendar_empty()}</p>
		{:else}
			{#each grouped as [day, events] (day)}
				<div class="mb-5">
					<h3 class="mb-2 text-xs font-semibold tracking-wide text-base-content/70 uppercase">
						{fmtDay(day)}
					</h3>
					<ul class="space-y-2">
						{#each events as ev (ev.id)}
							<li class="card bg-base-100 shadow-sm">
								<div class="card-body p-4">
									<div class="flex items-start gap-3">
										<div class="flex-1">
											<p class="font-medium">{ev.title}</p>
											{#if ev.notes}
												<p class="mt-1 text-sm whitespace-pre-wrap text-base-content/70">
													{ev.notes}
												</p>
											{/if}
											<div class="mt-2 flex flex-wrap gap-2 text-xs text-base-content/60">
												{#if ev.allDay}
													<span>🗓 {m.calendar_all_day_badge()}</span>
												{:else}
													<span
														>🕐 {fmtTime(ev.startsAt)}{ev.endsAt
															? ' – ' + fmtTime(ev.endsAt)
															: ''}</span
													>
												{/if}
												<span>
													{ev.createdBy === data.viewerId
														? m.calendar_added_by_you()
														: m.calendar_added_by_partner()}
												</span>
											</div>
										</div>
										<button
											class="btn text-error btn-ghost btn-xs"
											onclick={() => remove(ev.id)}
											aria-label={m.calendar_remove()}
										>
											✕
										</button>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		{/if}
	</section>
</main>
