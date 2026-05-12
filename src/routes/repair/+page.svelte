<script lang="ts">
	// F16 — Repair flow page.
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
	import type { PageData } from './$types';

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
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	const minMin = Math.ceil(REPAIR_COOLDOWN_MIN_MS / 60_000);
	const maxMin = Math.floor(REPAIR_COOLDOWN_MAX_MS / 60_000);

	async function start(e: Event) {
		e.preventDefault();
		const m = Math.max(minMin, Math.min(maxMin, cooldownMinutes));
		submitting = true;
		err = null;
		const r = await fetch('/api/repair', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				cooldownMs: m * 60_000,
				initiatorNote: initiatorNote.trim() || undefined,
				ephemeral
			})
		});
		submitting = false;
		if (!r.ok) {
			err = r.status === 409 ? 'A session is already active.' : `Failed (${r.status}).`;
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
			err = `Failed to save note (${r.status}).`;
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
			err = r.status === 409 ? 'Cooldown not elapsed yet.' : `Failed (${r.status}).`;
			return;
		}
		commitmentNote = '';
		await invalidateAll();
	}

	async function cancel() {
		if (!active) return;
		if (!confirm('Cancel this repair session?')) return;
		submitting = true;
		err = null;
		const r = await fetch(`/api/repair/${active.id}/cancel`, { method: 'POST' });
		submitting = false;
		if (!r.ok) {
			err = `Failed to cancel (${r.status}).`;
			return;
		}
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Repair · DuoSync</title>
</svelte:head>

<main class="repair">
	<header>
		<h1>Repair</h1>
		<p class="lead">A small ritual for after a fight. Take a breath, then come back together.</p>
	</header>

	{#if err}
		<div class="alert" role="alert">{err}</div>
	{/if}

	{#if !active}
		<section class="card">
			<h2>Start a repair</h2>
			<form onsubmit={start}>
				<label>
					Cool-off length
					<input
						type="number"
						min={minMin}
						max={maxMin}
						bind:value={cooldownMinutes}
						aria-describedby="cooldown-hint"
					/>
					<span id="cooldown-hint" class="hint">minutes (between {minMin} and {maxMin})</span>
				</label>

				<label>
					Note to your partner (optional, private until they open the page)
					<textarea
						bind:value={initiatorNote}
						maxlength={REPAIR_NOTE_MAX_LEN}
						rows="3"
						placeholder="What's on your mind?"
					></textarea>
				</label>

				<label class="row">
					<input type="checkbox" bind:checked={ephemeral} />
					Forget this session after we close it
				</label>

				<button type="submit" disabled={submitting}>
					{submitting ? 'Starting…' : 'Start repair'}
				</button>
			</form>
		</section>
	{:else}
		<section class="session card">
			<header class="session-head">
				<span class="status status-{active.status}">{active.status}</span>
				<small>started {new Date(active.startedAt).toLocaleString()}</small>
			</header>

			{#if cooldownActive}
				<div class="cooldown" aria-live="polite">
					<div class="countdown">{fmtCountdown(cooldownRemainingMs)}</div>
					<p>Breathe slowly. The reflection prompts unlock when the timer ends.</p>
				</div>
			{:else}
				<p class="ready">Cool-off complete. Take a moment together.</p>
			{/if}

			{#if active.initiatorNote}
				<div class="note-box">
					<h3>{isInitiator ? 'Your opening note' : 'Their opening note'}</h3>
					<p>{active.initiatorNote}</p>
				</div>
			{/if}

			{#if !isInitiator}
				<form onsubmit={join}>
					<label>
						Your reflection
						<textarea
							bind:value={partnerNote}
							maxlength={REPAIR_NOTE_MAX_LEN}
							rows="3"
							placeholder={active.partnerNote ?? 'What did you hear? What do you need?'}
						></textarea>
					</label>
					<button type="submit" disabled={submitting}>
						{active.partnerNote ? 'Update reflection' : 'Save reflection'}
					</button>
				</form>
				{#if active.partnerNote}
					<div class="note-box">
						<h3>Your saved reflection</h3>
						<p>{active.partnerNote}</p>
					</div>
				{/if}
			{:else if active.partnerNote}
				<div class="note-box">
					<h3>Their reflection</h3>
					<p>{active.partnerNote}</p>
				</div>
			{/if}

			<form onsubmit={complete}>
				<label>
					Joint commitment (optional)
					<textarea
						bind:value={commitmentNote}
						maxlength={REPAIR_NOTE_MAX_LEN}
						rows="2"
						placeholder="One thing we agreed on…"
					></textarea>
				</label>
				<div class="actions">
					<button type="submit" disabled={submitting || !canComplete}>
						{canComplete ? 'Mark complete' : `Available in ${fmtCountdown(cooldownRemainingMs)}`}
					</button>
					<button type="button" class="ghost" onclick={cancel} disabled={submitting}>
						Cancel session
					</button>
				</div>
			</form>
		</section>
	{/if}

	{#if data.history.length > 0}
		<section class="card">
			<h2>Past sessions</h2>
			<ul class="history">
				{#each data.history as h (h.id)}
					<li>
						<span class="status status-{h.status}">{h.status}</span>
						<time>{new Date(h.startedAt).toLocaleDateString()}</time>
						{#if h.commitmentNote}
							<p class="commitment">“{h.commitmentNote}”</p>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>

<style>
	.repair {
		max-width: 640px;
		margin: 0 auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.lead {
		color: var(--muted, #6b7280);
		margin: 0.25rem 0 0;
	}
	.card {
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e5e7eb);
		border-radius: 0.75rem;
		padding: 1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.card h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	label.row {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}
	input[type='number'],
	textarea {
		font: inherit;
		padding: 0.5rem;
		border: 1px solid var(--border, #d1d5db);
		border-radius: 0.5rem;
		background: var(--input-bg, #fff);
		color: inherit;
	}
	.hint {
		font-size: 0.8rem;
		color: var(--muted, #6b7280);
	}
	button {
		padding: 0.65rem 1rem;
		font: inherit;
		font-weight: 600;
		border: none;
		border-radius: 0.5rem;
		background: var(--accent, #4f46e5);
		color: #fff;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	button.ghost {
		background: transparent;
		color: var(--accent, #4f46e5);
		border: 1px solid currentColor;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.session-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.status {
		font-size: 0.75rem;
		text-transform: uppercase;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--chip-bg, #eef2ff);
		color: var(--chip-fg, #4338ca);
	}
	.status-completed {
		background: #d1fae5;
		color: #065f46;
	}
	.status-cancelled {
		background: #fee2e2;
		color: #991b1b;
	}
	.cooldown {
		text-align: center;
		padding: 1rem 0;
	}
	.countdown {
		font-size: 3rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.ready {
		font-weight: 600;
		color: var(--accent, #4f46e5);
	}
	.note-box {
		background: var(--note-bg, #f9fafb);
		border-radius: 0.5rem;
		padding: 0.75rem;
	}
	.note-box h3 {
		margin: 0 0 0.25rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		color: var(--muted, #6b7280);
	}
	.note-box p {
		margin: 0;
		white-space: pre-wrap;
	}
	.history {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.history li {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		gap: 0.25rem 0.5rem;
		align-items: center;
	}
	.history time {
		font-size: 0.85rem;
		color: var(--muted, #6b7280);
	}
	.commitment {
		grid-column: 1 / -1;
		margin: 0;
		font-style: italic;
		color: var(--muted, #4b5563);
	}
	.alert {
		padding: 0.75rem;
		background: #fee2e2;
		color: #991b1b;
		border-radius: 0.5rem;
	}
</style>
