<!--
	/hourly — F11 Setlog-style hour pager (U6).

	Single-hour pager: two stacked 16:9 tiles (you / partner) for the
	currently selected hour bucket, swipe or chevrons to navigate.
	The current-hour your-tile doubles as the capture affordance,
	routed through RotatePrompt → HourlyRecorder (landscape).

	Mood picker: a 5-emoji row shown below the pager only when the
	selected bucket is the current hour. Realtime: a partner's new
	clip / mood landing triggers a refetch.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import { HubHeader, momentsChips } from '$lib/components/duosync';
	import HourlyRecorder from '$lib/components/hourly/HourlyRecorder.svelte';
	import HourlyPager from '$lib/components/hourly/HourlyPager.svelte';
	import HourListSheet from '$lib/components/hourly/HourListSheet.svelte';
	import RotatePrompt from '$lib/components/hourly/RotatePrompt.svelte';
	import { createRealtimeClient } from '$lib/client/realtime.svelte';
	import { currentBucket, isCurrentHour } from '$lib/hourly/dayNav';
	import type { Mood, PagerCell } from '$lib/hourly/types';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	const MOODS: ReadonlyArray<{ value: Mood; emoji: string; label: () => string }> = [
		{ value: 'joyful', emoji: '😄', label: m.hourly_mood_joyful },
		{ value: 'happy', emoji: '🙂', label: m.hourly_mood_happy },
		{ value: 'neutral', emoji: '😐', label: m.hourly_mood_neutral },
		{ value: 'sad', emoji: '🙁', label: m.hourly_mood_sad },
		{ value: 'upset', emoji: '😣', label: m.hourly_mood_upset }
	];

	interface DayCell {
		hourBucket: string;
		clip: { id: string; mime: string; playbackUrl: string; expiresIn: number } | null;
		mood: Mood | null;
	}
	interface DayPayload {
		dateIso: string;
		you: { userId: string; cells: DayCell[] };
		partner: { userId: string | null; cells: DayCell[] };
	}

	let day: DayPayload | null = $state(null);
	let loading = $state(true);
	let loadError: string | null = $state(null);
	let recorderOpen = $state(false);
	let savingMood: Mood | null = $state(null);
	let selectedBucket = $state(currentBucket());
	let rotateGate = $state<null | 'pending' | 'cleared'>(null);
	let hourSheetOpen = $state(false);

	const pagerCells = $derived.by(() => {
		const you: Record<string, PagerCell> = {};
		const partner: Record<string, PagerCell> = {};
		if (day) {
			for (const c of day.you.cells) {
				you[c.hourBucket] = { hourBucket: c.hourBucket, clip: c.clip, mood: c.mood };
			}
			for (const c of day.partner.cells) {
				partner[c.hourBucket] = { hourBucket: c.hourBucket, clip: c.clip, mood: c.mood };
			}
		}
		return { you, partner };
	});

	const isCurrent = $derived(isCurrentHour(selectedBucket));
	const currentYouCell = $derived(pagerCells.you[selectedBucket] ?? null);

	function openRecorder(): void {
		rotateGate = 'pending';
	}
	function onLandscapeReady(): void {
		rotateGate = 'cleared';
		recorderOpen = true;
	}
	function cancelRotate(): void {
		rotateGate = null;
	}

	function todayIso(): string {
		// Hour buckets are stored and indexed in UTC server-side; the
		// pager and cells dict key off UTC hour ISO strings. The day
		// endpoint expects the matching UTC date so the user's current
		// hour bucket falls within the returned 24-hour window.
		return new Date().toISOString().slice(0, 10);
	}

	async function load(): Promise<void> {
		loading = true;
		loadError = null;
		try {
			const res = await fetch(`${resolve('/api/hourly/day')}?date=${todayIso()}`);
			if (!res.ok) throw new Error(await res.text());
			day = (await res.json()) as DayPayload;
		} catch (e) {
			loadError = (e as Error).message ?? 'load_failed';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const rt = createRealtimeClient(
		untrack(() => ({ coupleId: data.coupleId, userId: data.viewerId }))
	);
	onMount(() => {
		void rt.start();
		return () => rt.stop();
	});
	let lastSeenHourly = 0;
	$effect(() => {
		const ts = rt.lastHourlyChangeAt;
		if (ts > lastSeenHourly) {
			lastSeenHourly = ts;
			if (!loading) void load();
			// Realtime auto-snap: when a new clip lands while the user is
			// already viewing the current hour, keep them on it as the
			// clock rolls over.
			if (isCurrentHour(selectedBucket)) selectedBucket = currentBucket();
		}
	});

	// Today's 24 buckets in chronological order, derived from the day
	// payload so the BottomSheet matches what /api/hourly/day returned.
	const dayBuckets = $derived.by(() => {
		if (!day) return [] as string[];
		return day.you.cells.map((c) => c.hourBucket);
	});

	async function setMood(value: Mood): Promise<void> {
		savingMood = value;
		try {
			const res = await fetch(resolve('/api/hourly/mood'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mood: value })
			});
			if (res.ok) await load();
		} finally {
			savingMood = null;
		}
	}
</script>

<svelte:head><title>{m.hourly_title()} · DuoSync</title></svelte:head>

<HubHeader
	chips={momentsChips}
	current={page.url.pathname}
	title={m.hub_moments_title}
	fallbackHref="/moments"
/>

{#if rotateGate === 'pending'}
	<RotatePrompt onlandscape={onLandscapeReady} oncancel={cancelRotate} />
{/if}
{#if recorderOpen}
	<HourlyRecorder
		aspect="landscape"
		onsuccess={() => {
			recorderOpen = false;
			rotateGate = null;
			void load();
		}}
		oncancel={() => {
			recorderOpen = false;
			rotateGate = null;
		}}
	/>
{/if}

<main class="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col">
	{#if loading}
		<p class="p-4 text-sm text-base-content/60">{m.hourly_loading()}</p>
	{:else if loadError}
		<p class="p-4 text-sm text-error">
			{m.hourly_load_failed()}
			<button class="underline" onclick={load}>{m.hourly_retry()}</button>
		</p>
	{:else}
		<HourlyPager
			{selectedBucket}
			youCells={pagerCells.you}
			partnerCells={pagerCells.partner}
			onselect={(b) => (selectedBucket = b)}
			oncapture={openRecorder}
			onpickhour={() => (hourSheetOpen = true)}
		/>

		{#if isCurrent}
			<div class="flex justify-between gap-1 px-3 pb-4">
				{#each MOODS as mood (mood.value)}
					{@const active = currentYouCell?.mood === mood.value}
					<button
						type="button"
						aria-label={mood.label()}
						aria-pressed={active}
						disabled={savingMood !== null}
						class="flex h-12 w-12 items-center justify-center rounded-full border text-2xl transition disabled:opacity-50 {active
							? 'border-primary bg-primary/15'
							: 'border-base-content/15 hover:bg-base-300'}"
						onclick={() => setMood(mood.value)}
					>
						{mood.emoji}
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</main>

<HourListSheet
	bind:open={hourSheetOpen}
	buckets={dayBuckets}
	youCells={pagerCells.you}
	partnerCells={pagerCells.partner}
	{selectedBucket}
	onselect={(b) => (selectedBucket = b)}
	onclose={() => (hourSheetOpen = false)}
/>
