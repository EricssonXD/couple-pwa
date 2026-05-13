<!--
  MoodPicker — F5 mood pulse input.

  Five-bucket mood picker rendered as an accessible radio group of
  hand-drawn MoodFace SVGs. The component owns its own POST + pending
  state; callers wire the current value (server snapshot) and a
  callback for the success case so they can update partner-visible
  state optimistically.

  Behavior:
    - Disabled while a POST is in flight or `online === false`.
    - Same-mood click is a no-op (server-side dedupe within 60s anyway).
    - Failure surfaces a non-blocking inline error string.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import type { Mood } from '$lib/server/services/mood';
	import MoodFace from '$lib/components/ui/MoodFace.svelte';

	type Props = {
		current: Mood | null;
		online?: boolean;
		onChange?: (mood: Mood) => void;
	};
	let { current, online = true, onChange }: Props = $props();

	let pending = $state(false);
	let error = $state<string | null>(null);

	const OPTIONS: Array<{ value: Mood; label: () => string }> = [
		{ value: 'joyful', label: () => m.mood_pick_joyful() },
		{ value: 'happy', label: () => m.mood_pick_happy() },
		{ value: 'neutral', label: () => m.mood_pick_neutral() },
		{ value: 'sad', label: () => m.mood_pick_sad() },
		{ value: 'upset', label: () => m.mood_pick_upset() }
	];

	async function pick(next: Mood) {
		if (pending || !online) return;
		if (next === current) return;
		pending = true;
		error = null;
		try {
			const res = await fetch('/api/mood', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mood: next })
			});
			if (!res.ok) {
				error = m.mood_save_failed();
				return;
			}
			current = next;
			onChange?.(next);
		} catch {
			error = m.mood_save_failed();
		} finally {
			pending = false;
		}
	}

	function onKey(e: KeyboardEvent, idx: number) {
		// Radio-group keyboard nav: arrows move + activate (WAI-ARIA pattern).
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		e.preventDefault();
		const dir = e.key === 'ArrowRight' ? 1 : -1;
		const next = OPTIONS[(idx + dir + OPTIONS.length) % OPTIONS.length];
		void pick(next.value);
	}
</script>

<div
	role="radiogroup"
	aria-label={m.mood_picker_label()}
	aria-disabled={!online || pending}
	class="rounded-[var(--radius-card)] bg-base-200 p-3 shadow-paper"
>
	<p class="mb-2 text-center text-xs font-semibold text-base-content/70">
		{m.mood_picker_label()}
	</p>
	<div class="flex justify-between gap-1" data-testid="mood-picker">
		{#each OPTIONS as opt, i (opt.value)}
			{@const selected = current === opt.value}
			<button
				type="button"
				role="radio"
				aria-checked={selected}
				aria-label={opt.label()}
				disabled={pending || !online}
				class="flex h-12 w-12 items-center justify-center rounded-full transition disabled:opacity-50"
				class:bg-primary={selected}
				class:text-primary-content={selected}
				class:bg-base-100={!selected}
				onclick={() => pick(opt.value)}
				onkeydown={(e) => onKey(e, i)}
				data-mood={opt.value}
			>
				<MoodFace mood={opt.value} size={28} tinted={!selected} />
			</button>
		{/each}
	</div>
	{#if !online}
		<p class="mt-2 text-center text-[11px] text-base-content/50" aria-live="polite">
			{m.mood_offline()}
		</p>
	{:else if error}
		<p class="mt-2 text-center text-[11px] text-error" aria-live="assertive">{error}</p>
	{/if}
</div>
