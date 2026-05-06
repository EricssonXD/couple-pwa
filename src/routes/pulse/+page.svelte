<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto, invalidate } from '$app/navigation';
	import { signOut } from '$lib/auth-client';
	import { createGeolocationTracker } from '$lib/client/geolocation.svelte';
	import { relativeTime } from '$lib/utils/time';
	import DistanceBubble from '$lib/components/DistanceBubble.svelte';
	import type { DistanceBucket } from '$lib/server/services/location';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type StateResp = {
		me: { capturedAt: string; batteryPct: number | null; charging: boolean | null } | null;
		partner:
			| {
					capturedAt: string | null;
					batteryPct: number | null;
					charging: boolean | null;
					ghost: boolean;
			  }
			| null
			| undefined;
		distanceM: number | null;
		bucket: DistanceBucket;
	};

	const tracker = createGeolocationTracker();
	let live = $state<StateResp>(data.initialState as unknown as StateResp);
	let ghostOn = $state(data.me.ghostMode);
	let ghostBusy = $state(false);
	let now = $state(Date.now()); // ticks every 30s so relative times stay fresh
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;

	async function refreshState() {
		try {
			const res = await fetch('/api/location/state');
			if (res.ok) live = (await res.json()) as StateResp;
		} catch {
			/* swallow — next tick will retry */
		}
	}

	async function toggleGhost() {
		ghostBusy = true;
		const next = !ghostOn;
		try {
			const res = await fetch('/api/location/ghost', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ enabled: next })
			});
			if (res.ok) {
				ghostOn = next;
				if (next) tracker.stop();
				else void tracker.start();
				await invalidate('/pulse');
			}
		} finally {
			ghostBusy = false;
		}
	}

	async function handleSignOut() {
		tracker.stop();
		await signOut();
		await goto('/');
	}

	onMount(() => {
		if (!ghostOn) void tracker.start();
		pollTimer = setInterval(refreshState, 30_000);
		tickTimer = setInterval(() => (now = Date.now()), 30_000);
	});

	onDestroy(() => {
		tracker.stop();
		if (pollTimer) clearInterval(pollTimer);
		if (tickTimer) clearInterval(tickTimer);
	});

	const partnerName = $derived(data.partner?.displayName ?? data.partner?.name ?? 'them');
	const partnerLastSeen = $derived(
		live.partner ? relativeTime(live.partner.capturedAt ?? null, now) : ''
	);
	const myLastSeen = $derived(live.me ? relativeTime(live.me.capturedAt, now) : '');
</script>

<svelte:head>
	<title>Pulse — DuoSync</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-10">
	<header class="flex items-center justify-between">
		<div>
			<p class="text-base-content/60 text-xs tracking-wider uppercase">Pulse</p>
			<h1 class="text-3xl font-semibold tracking-tight">You & {partnerName}</h1>
		</div>
		<button class="btn btn-ghost btn-sm" type="button" onclick={handleSignOut}>Sign out</button>
	</header>

	<div class="mt-6 flex items-center gap-4 text-5xl">
		<span aria-label="you">{data.me.avatarEmoji ?? '💗'}</span>
		<span class="opacity-40">·</span>
		<span aria-label="partner">{data.partner?.avatarEmoji ?? '💗'}</span>
	</div>

	<section class="mt-6">
		{#if live.partner && 'ghost' in live.partner && live.partner.ghost}
			<div class="card bg-base-200 text-base-content shadow">
				<div class="card-body items-center text-center">
					<p class="text-sm tracking-wider uppercase opacity-70">Partner</p>
					<p class="text-3xl font-semibold">隱身中</p>
					<p class="text-sm opacity-70">
						Last seen {partnerLastSeen || 'a while ago'}
					</p>
				</div>
			</div>
		{:else}
			<DistanceBubble distanceM={live.distanceM} bucket={live.bucket} />
		{/if}
	</section>

	<section class="mt-6 grid grid-cols-2 gap-3">
		<article class="card bg-base-200">
			<div class="card-body p-4">
				<p class="text-xs tracking-wider uppercase opacity-60">You</p>
				<p class="mt-1 text-lg font-medium">
					{live.me?.batteryPct != null ? `${live.me.batteryPct}%` : '—'}
					{#if live.me?.charging}<span aria-label="charging">⚡</span>{/if}
				</p>
				<p class="text-xs opacity-60">{myLastSeen || 'no fix yet'}</p>
			</div>
		</article>
		<article class="card bg-base-200">
			<div class="card-body p-4">
				<p class="text-xs tracking-wider uppercase opacity-60">{partnerName}</p>
				<p class="mt-1 text-lg font-medium">
					{live.partner && !('ghost' in live.partner && live.partner.ghost) && live.partner.batteryPct != null
						? `${live.partner.batteryPct}%`
						: '—'}
					{#if live.partner && !('ghost' in live.partner && live.partner.ghost) && live.partner.charging}
						<span aria-label="charging">⚡</span>
					{/if}
				</p>
				<p class="text-xs opacity-60">{partnerLastSeen || 'no fix yet'}</p>
			</div>
		</article>
	</section>

	<section class="mt-6">
		<div class="bg-base-200 flex items-center justify-between rounded-2xl p-4">
			<div>
				<p class="font-medium">Ghost mode</p>
				<p class="text-xs opacity-60">
					{ghostOn ? 'Sharing paused — partner sees 隱身中' : 'You are sharing your location'}
				</p>
			</div>
			<input
				type="checkbox"
				class="toggle toggle-primary"
				checked={ghostOn}
				disabled={ghostBusy}
				onchange={toggleGhost}
				aria-label="Toggle ghost mode"
			/>
		</div>
	</section>

	{#if tracker.status === 'denied'}
		<div role="alert" class="alert alert-warning mt-6">
			<span>
				Location permission denied. Enable it in your browser settings to share live distance.
			</span>
		</div>
	{:else if tracker.status === 'unsupported'}
		<div role="alert" class="alert alert-error mt-6">
			<span>Geolocation is not supported in this browser.</span>
		</div>
	{:else if tracker.status === 'requesting_permission'}
		<p class="mt-6 text-center text-sm opacity-70">Requesting location permission…</p>
	{:else if tracker.status === 'error' && tracker.lastError}
		<p class="mt-6 text-center text-xs opacity-60">Sync issue: {tracker.lastError} · retrying…</p>
	{/if}

	<section class="prose mt-10">
		<h2 class="text-lg">Coming next</h2>
		<ul class="text-sm">
			<li>Heartbeat tap (haptic ping)</li>
			<li>Mood weather + anniversary ribbon</li>
			<li>Whisper chat + geo-moments</li>
		</ul>
	</section>
</main>

