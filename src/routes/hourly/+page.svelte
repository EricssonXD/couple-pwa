<!--
	/hourly — F11 day grid.

	Layout: 24 rows × 2 columns (you / partner). Each cell shows the
	hour label, a 2-second clip thumbnail (autoplay-on-tap), and a
	mood emoji. Top of page: a "capture this hour" CTA when the
	current hour is unfilled, plus a 5-emoji mood picker for the
	current hour.

	Strings are placeholder English; H8 lands i18n.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import { HubHeader, momentsChips } from '$lib/components/duosync';
	import HourlyRecorder from '$lib/components/hourly/HourlyRecorder.svelte';
	import HourlyPager from '$lib/components/hourly/HourlyPager.svelte';
	import RotatePrompt from '$lib/components/hourly/RotatePrompt.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import { createRealtimeClient } from '$lib/client/realtime.svelte';
	import { currentBucket } from '$lib/hourly/dayNav';
	import type { PagerCell } from '$lib/hourly/types';
	import type { PageData } from './$types';

	// data is unused — page is fully client-driven via /api/hourly/day,
	// but the +page.server.ts load gates auth + couple-paired access.
	const { data }: { data: PageData } = $props();

	type Mood = 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset';
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

	// U5: opt-in flag for the new Setlog-style pager.
	const pagerMode = $derived(page.url.searchParams.get('ui') === 'pager');
	let selectedBucket = $state(currentBucket());
	let rotateGate = $state<null | 'pending' | 'cleared'>(null);

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

	function openRecorderFromPager(): void {
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
		const now = new Date();
		return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
	}

	function currentHourIndex(): number {
		// Local-tz hour index for "current hour" CTA targeting.
		return new Date().getHours();
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

	// F11 H5: subscribe to the couple realtime channel so a partner's
	// new clip / mood landing causes us to refetch the day grid (with
	// freshly-minted signed playback URLs). Broadcast payloads carry
	// metadata only by design — a refetch is the only way to obtain a
	// playback URL for a new clip.
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
		}
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

	function onCaptureSuccess(): void {
		recorderOpen = false;
		void load();
	}

	function hourLabel(idx: number): string {
		// Build a fresh Date for the requested hour-of-today without
		// mutating any shared instance (svelte/prefer-svelte-reactivity).
		const now = new Date();
		const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), idx, 0, 0, 0);
		return d.toLocaleTimeString(undefined, { hour: 'numeric' });
	}
</script>

<svelte:head><title>{m.hourly_title()} · DuoSync</title></svelte:head>

<HubHeader
	chips={momentsChips}
	current={page.url.pathname}
	title={m.hub_moments_title}
	fallbackHref="/moments"
/>

{#if pagerMode}
	{#if rotateGate === 'pending'}
		<RotatePrompt onlandscape={onLandscapeReady} oncancel={cancelRotate} />
	{/if}
	{#if recorderOpen}
		<div class="fixed inset-0 z-40 bg-base-100">
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
		</div>
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
				oncapture={openRecorderFromPager}
			/>
		{/if}
	</main>
{:else}
	<main class="mx-auto max-w-md px-4 pt-4 pb-24">
		<h1 class="mb-1 text-xl font-semibold">{m.hourly_title()}</h1>
		<p class="mb-4 text-sm text-base-content/60">
			{m.hourly_subtitle()}
		</p>

		<section class="mb-6 rounded-2xl border border-base-content/10 bg-base-200/40 p-4">
			<h2 class="mb-2 text-sm font-semibold">
				{m.hourly_right_now({ hour: hourLabel(currentHourIndex()) })}
			</h2>
			{#if recorderOpen}
				<HourlyRecorder onsuccess={onCaptureSuccess} oncancel={() => (recorderOpen = false)} />
			{:else}
				{@const youCells = day?.you.cells ?? []}
				{@const currentCell = youCells[currentHourIndex()]}
				{#if currentCell?.clip}
					<p class="mb-2 text-xs text-success">{m.hourly_captured_this_hour()}</p>
				{:else}
					<PillButton variant="primary" block onclick={() => (recorderOpen = true)}>
						{m.hourly_capture_cta()}
					</PillButton>
				{/if}
				<div class="mt-3 flex justify-between gap-1">
					{#each MOODS as mood (mood.value)}
						{@const active = currentCell?.mood === mood.value}
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
		</section>

		{#if loading}
			<p class="text-sm text-base-content/60">{m.hourly_loading()}</p>
		{:else if loadError}
			<p class="text-sm text-error">
				{m.hourly_load_failed()}
				<button class="underline" onclick={load}>{m.hourly_retry()}</button>
			</p>
		{:else if day}
			<section>
				<header
					class="mb-2 grid grid-cols-[3rem_1fr_1fr] items-center gap-2 px-1 text-xs font-semibold tracking-wider text-base-content/50 uppercase"
				>
					<span></span>
					<span>{m.hourly_col_you()}</span>
					<span>{m.hourly_col_partner()}</span>
				</header>
				<ol class="space-y-1">
					{#each day.you.cells as youCell, idx (youCell.hourBucket)}
						{@const partnerCell = day.partner.cells[idx]}
						{@const isCurrent = idx === currentHourIndex()}
						<li
							class="grid grid-cols-[3rem_1fr_1fr] items-center gap-2 rounded-lg p-1 {isCurrent
								? 'bg-primary/5 ring-1 ring-primary/20'
								: ''}"
						>
							<span class="text-xs text-base-content/50">{hourLabel(idx)}</span>
							{#each [youCell, partnerCell ?? null] as cell, col (col)}
								<div
									class="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-base-300/40"
								>
									{#if cell?.clip}
										<video
											src={cell.clip.playbackUrl}
											class="h-full w-full object-cover"
											muted
											playsinline
											loop
											preload="metadata"
											onmouseenter={(e) => (e.currentTarget as HTMLVideoElement).play()}
											onclick={(e) => {
												const v = e.currentTarget as HTMLVideoElement;
												if (v.paused) void v.play();
												else v.pause();
											}}
										></video>
									{:else if cell?.mood}
										<span class="text-2xl opacity-70">
											{MOODS.find((mm) => mm.value === cell.mood)?.emoji ?? ''}
										</span>
									{:else}
										<span class="text-xs text-base-content/30">—</span>
									{/if}
								</div>
							{/each}
						</li>
					{/each}
				</ol>
			</section>
		{/if}
	</main>
{/if}
