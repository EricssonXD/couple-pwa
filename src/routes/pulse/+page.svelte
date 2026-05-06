<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto, invalidate } from '$app/navigation';
	import { getSupabaseClient } from '$lib/auth-client';
	import { createGeolocationTracker } from '$lib/client/geolocation.svelte';
	import { createRealtimeClient } from '$lib/client/realtime.svelte';
	import { createOnlineStatus } from '$lib/client/online.svelte';
	import { idbGet, idbSet } from '$lib/client/idb';
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

	type CachedSnapshot = {
		live: StateResp;
		ghostOn: boolean;
		savedAt: number;
	};

	const CACHE_KEY = `pulse:${data.coupleId}`;

	const tracker = createGeolocationTracker();
	const rt = createRealtimeClient({ coupleId: data.coupleId, userId: data.me.id });
	const net = createOnlineStatus();
	let live = $state<StateResp>(data.initialState as unknown as StateResp);
	let ghostOn = $state(data.me.ghostMode);
	let ghostBusy = $state(false);
	let now = $state(Date.now());
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;
	let tapPulse = $state(0);
	// Persistence is gated until after we've attempted to hydrate from IDB —
	// otherwise the first $effect run would overwrite the cached snapshot with
	// the (possibly older) server-rendered state before we get a chance to read it.
	let hydrated = $state(false);

	const partnerId = $derived(data.partner?.id ?? '');
	const partnerPresence = $derived(rt.presence[partnerId] ?? 'offline');

	$effect(() => {
		const u = rt.lastLocation;
		if (!u || u.userId !== partnerId) return;
		live = {
			...live,
			distanceM: u.distanceM,
			bucket: u.bucket,
			partner: {
				capturedAt: u.capturedAt,
				batteryPct: u.batteryPct,
				charging: u.charging,
				ghost: false
			}
		};
	});

	$effect(() => {
		const g = rt.lastGhost;
		if (!g || g.userId !== partnerId) return;
		if (g.ghost) {
			live = {
				...live,
				distanceM: null,
				bucket: 'unknown',
				partner: {
					capturedAt: live.partner?.capturedAt ?? null,
					batteryPct: null,
					charging: null,
					ghost: true
				}
			};
		} else {
			void refreshState();
		}
	});

	$effect(() => {
		const t = rt.lastTap;
		if (!t) return;
		tapPulse = t;
		try {
			navigator.vibrate?.([40, 30, 40]);
		} catch {
			/* not supported */
		}
	});

	// Persist the latest snapshot to IDB whenever live or ghostOn changes so the
	// next cold load (even offline) can hydrate immediately.
	$effect(() => {
		if (!hydrated) return;
		const snapshot: CachedSnapshot = { live, ghostOn, savedAt: Date.now() };
		void idbSet(CACHE_KEY, snapshot);
	});

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

	function sendTap() {
		void rt.sendHeartbeatTap();
		try {
			navigator.vibrate?.(20);
		} catch {
			/* noop */
		}
	}

	async function handleSignOut() {
		tracker.stop();
		void rt.stop();
		await getSupabaseClient().auth.signOut();
		await goto('/');
	}

	onMount(async () => {
		// Try to upgrade the initial server data with a fresher cached snapshot.
		// SSR/cached HTML may carry stale state; live realtime data persisted from
		// a previous session can be newer. Hydrate before starting the tracker so
		// users see something instantly even when offline.
		const cached = await idbGet<CachedSnapshot>(CACHE_KEY);
		if (cached) {
			const cachedTs = Date.parse(cached.live?.partner?.capturedAt ?? '') || 0;
			const liveTs = Date.parse(live?.partner?.capturedAt ?? '') || 0;
			if (cachedTs > liveTs) live = cached.live;
		}
		hydrated = true;

		if (!ghostOn) void tracker.start();
		void rt.start();
		pollTimer = setInterval(refreshState, 30_000);
		tickTimer = setInterval(() => (now = Date.now()), 30_000);
	});

	onDestroy(() => {
		tracker.stop();
		void rt.stop();
		if (pollTimer) clearInterval(pollTimer);
		if (tickTimer) clearInterval(tickTimer);
	});

	const partnerName = $derived(data.partner?.displayName ?? 'them');
	const partnerLastSeen = $derived(
		live.partner ? relativeTime(live.partner.capturedAt ?? null, now) : ''
	);
	const myLastSeen = $derived(live.me ? relativeTime(live.me.capturedAt, now) : '');
	const presenceDot = $derived(
		partnerPresence === 'online'
			? 'bg-success'
			: partnerPresence === 'away'
				? 'bg-warning'
				: 'bg-base-300'
	);
</script>

<svelte:head>
	<title>Pulse — DuoSync</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-10">
	{#if !net.online}
		<div
			role="status"
			class="alert alert-warning mb-4 py-2 text-sm"
			aria-live="polite"
		>
			<span>Offline — showing last known state.</span>
		</div>
	{/if}
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
		<span class="relative inline-block" aria-label="partner">
			{data.partner?.avatarEmoji ?? '💗'}
			<span
				class="border-base-100 absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 {presenceDot}"
				title={partnerPresence}
				aria-label="partner {partnerPresence}"
			></span>
		</span>
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

	<section class="mt-6">
		<button
			type="button"
			class="btn btn-primary btn-lg btn-block gap-3"
			onclick={sendTap}
			aria-label="Send heartbeat tap"
		>
			<span class="text-2xl">💓</span>
			Send a heartbeat
		</button>
		{#if tapPulse}
			{#key tapPulse}
				<p class="text-primary mt-2 animate-pulse text-center text-sm">
					{partnerName} tapped you 💞
				</p>
			{/key}
		{/if}
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

