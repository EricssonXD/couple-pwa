<script lang="ts">
	// Repair flow page.
	// Three states drive the UI:
	//   1. No active session  → "Start a repair" form.
	//   2. status='cooldown'   → countdown + breathing prompt.
	//   3. status='reflecting' (cooldown elapsed) → reflection prompts +
	//      "Mark complete" button. Either party can also cancel.
	// History list lives at the bottom for transparency.

	import { invalidateAll } from '$app/navigation';
	import {
		REPAIR_NOTE_MAX_LEN,
		REPAIR_COOLDOWN_MIN_MS,
		REPAIR_COOLDOWN_MAX_MS,
		REPAIR_COOLDOWN_DEFAULT_MS
	} from '$lib/repair.constants';
	import * as m from '$lib/paraglide/messages.js';
	import HandshakeIcon from 'phosphor-svelte/lib/HandshakeIcon';
	import HourglassIcon from 'phosphor-svelte/lib/HourglassIcon';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
	import SectionHeader from '$lib/components/ui/SectionHeader.svelte';
	import type { PageData } from './$types';
	import Card from '$lib/components/ui/Card.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import { BackButton } from '$lib/components/duosync';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import Notice from '$lib/components/ui/Notice.svelte';
	import InputField from '$lib/components/ui/InputField.svelte';

	const { data }: { data: PageData } = $props();

	let cooldownMinutes = $state(Math.round(REPAIR_COOLDOWN_DEFAULT_MS / 60_000));
	let initiatorNote = $state('');
	let partnerNote = $state('');
	let commitmentNote = $state('');
	let ephemeral = $state(false);
	let submitting = $state(false);
	let err = $state<string | null>(null);

	// Tick every second so the countdown re-renders.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const active = $derived(data.active);
	const isInitiator = $derived(!!active && active.initiatorId === data.viewerId);
	const cooldownRemainingMs = $derived(
		active ? Math.max(0, new Date(active.coolOffUntil).getTime() - now) : 0
	);
	const cooldownActive = $derived(!!active && cooldownRemainingMs > 0);
	const canComplete = $derived(
		!!active &&
			(active.status === 'cooldown' || active.status === 'reflecting') &&
			cooldownRemainingMs === 0
	);

	function fmtCountdown(ms: number): string {
		const total = Math.ceil(ms / 1000);
		const min = Math.floor(total / 60);
		const sec = total % 60;
		return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
	}

	function statusLabel(status: string): string {
		switch (status) {
			case 'cooldown':
				return m.repair_status_cooldown();
			case 'reflecting':
				return m.repair_status_reflecting();
			case 'completed':
				return m.repair_status_completed();
			case 'cancelled':
				return m.repair_status_cancelled();
			default:
				return status;
		}
	}

	function statusToneClass(status: string): string {
		switch (status) {
			case 'completed':
				return 'bg-success/15 text-success';
			case 'cancelled':
				return 'bg-error/15 text-error';
			case 'reflecting':
				return 'bg-secondary/15 text-secondary';
			default:
				return 'bg-primary/12 text-primary';
		}
	}

	const minMin = Math.ceil(REPAIR_COOLDOWN_MIN_MS / 60_000);
	const maxMin = Math.floor(REPAIR_COOLDOWN_MAX_MS / 60_000);

	async function start(e: Event) {
		e.preventDefault();
		const mins = Math.max(minMin, Math.min(maxMin, cooldownMinutes));
		submitting = true;
		err = null;
		const r = await fetch('/api/repair', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				cooldownMs: mins * 60_000,
				initiatorNote: initiatorNote.trim() || undefined,
				ephemeral
			})
		});
		submitting = false;
		if (!r.ok) {
			err =
				r.status === 409
					? m.repair_err_active()
					: m.repair_err_generic({ status: String(r.status) });
			return;
		}
		initiatorNote = '';
		await invalidateAll();
	}

	async function join(e: Event) {
		e.preventDefault();
		if (!active) return;
		submitting = true;
		err = null;
		const r = await fetch(`/api/repair/${active.id}/join`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				partnerNote: partnerNote.trim() || undefined
			})
		});
		submitting = false;
		if (!r.ok) {
			err = m.repair_err_save({ status: String(r.status) });
			return;
		}
		partnerNote = '';
		await invalidateAll();
	}

	async function complete(e: Event) {
		e.preventDefault();
		if (!active) return;
		submitting = true;
		err = null;
		const r = await fetch(`/api/repair/${active.id}/complete`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				commitmentNote: commitmentNote.trim() || undefined
			})
		});
		submitting = false;
		if (!r.ok) {
			err =
				r.status === 409
					? m.repair_err_cooldown()
					: m.repair_err_generic({ status: String(r.status) });
			return;
		}
		commitmentNote = '';
		await invalidateAll();
	}

	async function cancel() {
		if (!active) return;
		if (!confirm(m.repair_cancel_confirm())) return;
		submitting = true;
		err = null;
		const r = await fetch(`/api/repair/${active.id}/cancel`, { method: 'POST' });
		submitting = false;
		if (!r.ok) {
			err = m.repair_err_cancel({ status: String(r.status) });
			return;
		}
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>{m.repair_title_tag()}</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md space-y-5 px-4 py-8 pb-24">
	<BackButton fallbackHref="/daily" />
	<header class="space-y-1">
		<p class="text-xs tracking-wider text-base-content/60 uppercase">{m.repair_section_label()}</p>
		<h1 class="text-display text-3xl font-semibold tracking-wide">{m.repair_title()}</h1>
		<p class="text-sm leading-relaxed text-base-content/70">{m.repair_subtitle()}</p>
	</header>

	{#if err}
		<Notice>{err}</Notice>
	{/if}

	{#if !active}
		<Card class="space-y-4">
			<SectionHeader icon={HandshakeIcon} title={m.repair_start_heading()} />
			<form onsubmit={start} class="space-y-4">
				<label class="block space-y-1.5">
					<span class="text-xs font-semibold tracking-wider text-base-content/70 uppercase">
						{m.repair_cooldown_label()}
					</span>
					<InputField
						tone="sunken"
						size="sm"
						type="number"
						min={String(minMin)}
						max={String(maxMin)}
						bind:value={cooldownMinutes}
						aria-describedby="cooldown-hint"
					/>
					<span id="cooldown-hint" class="block text-xs text-base-content/55">
						{m.repair_cooldown_hint({ min: String(minMin), max: String(maxMin) })}
					</span>
				</label>

				<label class="block space-y-1.5">
					<span class="text-xs font-semibold tracking-wider text-base-content/70 uppercase">
						{m.repair_initiator_note_label()}
					</span>
					<InputField
						tone="sunken"
						size="sm"
						bind:value={initiatorNote}
						maxlength={REPAIR_NOTE_MAX_LEN}
						rows={3}
						placeholder={m.repair_initiator_note_placeholder()}
					/>
				</label>

				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={ephemeral} class="checkbox checkbox-sm" />
					<span>{m.repair_ephemeral_label()}</span>
				</label>

				<PillButton type="submit" block disabled={submitting}>
					{#if submitting}
						<Spinner />
						{m.repair_starting()}
					{:else}
						{m.repair_start_btn()}
					{/if}
				</PillButton>
			</form>
		</Card>
	{:else}
		<Card class="space-y-4">
			<header class="flex items-center justify-between gap-3">
				<span
					class="rounded-full px-2.5 py-1 text-[0.65rem] font-semibold tracking-wider uppercase {statusToneClass(
						active.status
					)}"
				>
					{statusLabel(active.status)}
				</span>
				<small class="text-xs text-base-content/55">
					{m.repair_started_at({ time: new Date(active.startedAt).toLocaleString() })}
				</small>
			</header>

			{#if cooldownActive}
				<div
					class="space-y-2 rounded-[var(--radius-field)] bg-base-100/70 py-6 text-center"
					aria-live="polite"
				>
					<HourglassIcon size={28} weight="duotone" class="mx-auto text-primary" />
					<div
						class="font-display text-5xl font-bold tracking-wider text-primary"
						style="font-variant-numeric: tabular-nums;"
					>
						{fmtCountdown(cooldownRemainingMs)}
					</div>
					<p class="px-4 text-sm text-base-content/70">{m.repair_cooldown_message()}</p>
				</div>
			{:else}
				<p class="flex items-center gap-2 text-sm font-medium text-primary">
					<HeartIcon size={16} weight="duotone" />
					{m.repair_cooldown_complete()}
				</p>
			{/if}

			{#if active.initiatorNote}
				<div class="space-y-1.5 rounded-[var(--radius-field)] bg-base-100/70 p-4">
					<p class="text-xs font-semibold tracking-wider text-base-content/60 uppercase">
						{isInitiator ? m.repair_initiator_note_yours() : m.repair_initiator_note_theirs()}
					</p>
					<p class="text-sm whitespace-pre-wrap">{active.initiatorNote}</p>
				</div>
			{/if}

			{#if !isInitiator}
				<form onsubmit={join} class="space-y-3">
					<label class="block space-y-1.5">
						<span class="text-xs font-semibold tracking-wider text-base-content/70 uppercase">
							{m.repair_partner_reflection_label()}
						</span>
						<InputField
							tone="sunken"
							size="sm"
							bind:value={partnerNote}
							maxlength={REPAIR_NOTE_MAX_LEN}
							rows={3}
							placeholder={active.partnerNote ?? m.repair_partner_reflection_placeholder()}
						/>
					</label>
					<PillButton
						type="submit"
						variant="outline"
						block
						disabled={submitting}
						class="border-primary/40 text-primary"
					>
						{active.partnerNote
							? m.repair_partner_reflection_update()
							: m.repair_partner_reflection_save()}
					</PillButton>
				</form>
				{#if active.partnerNote}
					<div class="space-y-1.5 rounded-[var(--radius-field)] bg-base-100/70 p-4">
						<p class="text-xs font-semibold tracking-wider text-base-content/60 uppercase">
							{m.repair_partner_reflection_yours()}
						</p>
						<p class="text-sm whitespace-pre-wrap">{active.partnerNote}</p>
					</div>
				{/if}
			{:else if active.partnerNote}
				<div class="space-y-1.5 rounded-[var(--radius-field)] bg-base-100/70 p-4">
					<p class="text-xs font-semibold tracking-wider text-base-content/60 uppercase">
						{m.repair_partner_reflection_theirs()}
					</p>
					<p class="text-sm whitespace-pre-wrap">{active.partnerNote}</p>
				</div>
			{/if}

			<form onsubmit={complete} class="space-y-3 border-t border-base-content/5 pt-4">
				<label class="block space-y-1.5">
					<span class="text-xs font-semibold tracking-wider text-base-content/70 uppercase">
						{m.repair_commitment_label()}
					</span>
					<InputField
						tone="sunken"
						size="sm"
						bind:value={commitmentNote}
						maxlength={REPAIR_NOTE_MAX_LEN}
						rows={2}
						placeholder={m.repair_commitment_placeholder()}
					/>
				</label>
				<div class="flex flex-col gap-2 sm:flex-row">
					<PillButton type="submit" disabled={submitting || !canComplete} class="flex-1">
						{canComplete
							? m.repair_complete_btn()
							: m.repair_complete_locked({ countdown: fmtCountdown(cooldownRemainingMs) })}
					</PillButton>
					<PillButton variant="subtle" onclick={cancel} disabled={submitting} class="px-5">
						{m.repair_cancel_btn()}
					</PillButton>
				</div>
			</form>
		</Card>
	{/if}

	{#if data.history.length > 0}
		<Card class="space-y-4">
			<SectionHeader
				icon={ClockCounterClockwiseIcon}
				title={m.repair_history_heading()}
				tone="muted"
			/>
			<ul class="space-y-3">
				{#each data.history as h (h.id)}
					<li class="space-y-1.5 rounded-[var(--radius-field)] bg-base-100/70 p-3">
						<div class="flex items-center justify-between gap-2">
							<span
								class="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold tracking-wider uppercase {statusToneClass(
									h.status
								)}"
							>
								{statusLabel(h.status)}
							</span>
							<time class="text-xs text-base-content/55">
								{new Date(h.startedAt).toLocaleDateString()}
							</time>
						</div>
						{#if h.commitmentNote}
							<p class="text-sm text-base-content/70 italic">“{h.commitmentNote}”</p>
						{/if}
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</main>
