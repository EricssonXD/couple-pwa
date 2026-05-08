<!--
  /pulse — DuoSync 主屏 main screen.

  舊頁邏輯整搬:
    - createGeolocationTracker → 持續位置 streaming
    - createRealtimeClient → Supabase channels (presence + broadcast)
    - createOnlineStatus → 網絡狀態
    - IDB cache (CACHE_KEY) → 冷啟動即顯
    - /api/location/state poll (30s 兜底)
    - /api/location/ghost POST → ghost toggle
    - rt.sendHeartbeatTap → POST /api/realtime/tap

  視層全換:
    - DistanceBubble 居中 (was old DistanceBubble)
    - PartnerAvatar 取代旧 emoji + presence dot
    - AnniversaryRibbon (rebuild)
    - GhostBanner (新, 自隱身時顯)
    - MemoryResurface (rebuild)
    - HeartbeatZone (新, 雙擊觸發 sendTap; 取代旧大按鈕)

  尚缺: MoodWeather (待後端 mood data; TODO).
-->
<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { goto, invalidate } from '$app/navigation';
	import { getSupabaseClient } from '$lib/auth-client';
	import { createGeolocationTracker } from '$lib/client/geolocation.svelte';
	import { createRealtimeClient } from '$lib/client/realtime.svelte';
	import { createOnlineStatus } from '$lib/client/online.svelte';
	import { idbGet, idbSet } from '$lib/client/idb';
	import { relativeTime } from '$lib/utils/time';
	import * as m from '$lib/paraglide/messages.js';
	import {
		DistanceBubble,
		PartnerAvatar,
		AnniversaryRibbon,
		GhostBanner,
		MemoryResurface,
		HeartbeatZone
	} from '$lib/components/duosync';
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

	type CachedSnapshot = { live: StateResp; ghostOn: boolean; savedAt: number };

	const CACHE_KEY = `pulse:${untrack(() => data.coupleId)}`;

	const tracker = createGeolocationTracker();
	const rt = createRealtimeClient(untrack(() => ({ coupleId: data.coupleId, userId: data.me.id })));
	const net = createOnlineStatus();

	let live = $state<StateResp>(untrack(() => data.initialState as unknown as StateResp));
	let ghostOn = $state(untrack(() => data.me.ghostMode));
	let ghostBusy = $state(false);
	let now = $state(Date.now());
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;
	let tapPulse = $state(0);
	// hydrated 為旗: 必先讀 IDB 再寫入, 否則第一輪 effect 會以 SSR 舊狀覆蓋緩存.
	let hydrated = $state(false);

	const partnerId = $derived(data.partner?.id ?? '');
	const partnerPresence = $derived(rt.presence[partnerId] ?? 'offline');
	const partnerGhost = $derived(
		Boolean(live.partner && 'ghost' in live.partner && live.partner.ghost)
	);

	// realtime: partner location update
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

	// realtime: partner ghost toggle
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

	// realtime: partner heartbeat tap → 自身震動 + 視覺 echo
	$effect(() => {
		const t = rt.lastTap;
		if (!t) return;
		tapPulse = t;
		try {
			navigator.vibrate?.([40, 30, 40]);
		} catch {
			/* unsupported */
		}
	});

	// 持續寫入 IDB, 供下次冷啟動秒顯
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
			/* swallow — 下次 poll 重試 */
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

	let lastSendAt = 0;
	function sendTap() {
		// 1s throttle 防連觸
		const t = Date.now();
		if (t - lastSendAt < 1000) return;
		lastSendAt = t;
		void rt.sendHeartbeatTap();
		// HeartbeatZone 已 vibrate(TAP_HEARTBEAT); 無需再震
	}

	async function handleSignOut() {
		tracker.stop();
		void rt.stop();
		await getSupabaseClient().auth.signOut();
		await goto('/');
	}

	onMount(async () => {
		// 先讀 IDB; 若緩存比 SSR 新則用緩存 (offline 友好)
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

	// PartnerAvatar.presence = 'online'|'away'|'ghost'|'offline'
	const partnerAvatarPresence = $derived.by(() => {
		if (partnerGhost) return 'ghost' as const;
		if (partnerPresence === 'online') return 'online' as const;
		if (partnerPresence === 'away') return 'away' as const;
		return 'offline' as const;
	});

	const partnerBattery = $derived(
		live.partner && !partnerGhost ? (live.partner.batteryPct ?? null) : null
	);
	const partnerCharging = $derived(Boolean(live.partner && !partnerGhost && live.partner.charging));
</script>

<svelte:head>
	<title>Pulse — DuoSync</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 pt-6 pb-32">
	<!-- 1. Top chrome: ribbon + 簽出 -->
	<header class="flex items-start gap-2">
		<div class="min-w-0 flex-1">
			<AnniversaryRibbon
				coupleSince={data.coupleSince}
				anniversary={data.anniversary}
				nickname={data.coupleNickname}
			/>
		</div>
		<button
			class="shrink-0 px-2 py-1 text-[11px] tracking-wider text-base-content/50 uppercase hover:text-base-content"
			type="button"
			onclick={handleSignOut}
			aria-label={m.settings_signout()}
		>
			{m.settings_signout()}
		</button>
	</header>

	<!-- 2. 自隱身時 banner + 解除 -->
	{#if ghostOn}
		<div class="mt-3">
			<GhostBanner ghostUntil={data.me.ghostUntil} onExit={ghostBusy ? undefined : toggleGhost} />
		</div>
	{/if}

	<!-- 3. 離線提示 -->
	{#if !net.online}
		<div
			role="status"
			class="mt-3 rounded-full bg-base-200 px-4 py-2 text-center text-xs text-base-content/70"
			aria-live="polite"
		>
			{m.pulse_offline()}
		</div>
	{/if}

	<!-- 4. 主距 DistanceBubble -->
	<section class="mt-8">
		<DistanceBubble
			distanceM={live.distanceM}
			bucket={live.bucket}
			ghost={partnerGhost || ghostOn}
		/>
	</section>

	<!-- 5. 雙人卡: 你 vs partner. avatar + battery ring + presence -->
	<section class="mt-8 grid grid-cols-2 gap-4">
		<article class="rounded-[var(--radius-card)] bg-base-200 p-4 text-center shadow-paper">
			<div class="flex justify-center">
				<PartnerAvatar
					displayName={data.me.displayName ?? m.pulse_you()}
					avatarEmoji={data.me.avatarEmoji}
					presence={ghostOn ? 'ghost' : 'online'}
					batteryPct={live.me?.batteryPct ?? null}
					charging={Boolean(live.me?.charging)}
					size={64}
				/>
			</div>
			<p class="mt-2 text-xs font-semibold text-base-content">{m.pulse_you()}</p>
			<p class="text-[11px] text-base-content/50">{myLastSeen || m.pulse_no_fix()}</p>
		</article>
		<article class="rounded-[var(--radius-card)] bg-base-200 p-4 text-center shadow-paper">
			<div class="flex justify-center">
				<PartnerAvatar
					displayName={partnerName}
					avatarEmoji={data.partner?.avatarEmoji ?? '🌱'}
					presence={partnerAvatarPresence}
					batteryPct={partnerBattery}
					charging={partnerCharging}
					size={64}
				/>
			</div>
			<p class="mt-2 text-xs font-semibold text-base-content">{partnerName}</p>
			<p class="text-[11px] text-base-content/50">
				{partnerGhost ? m.pulse_partner_hidden() : partnerLastSeen || m.pulse_no_fix()}
			</p>
		</article>
	</section>

	<!-- 6. Memory Resurface (如有) -->
	{#if data.memory}
		<section class="mt-6">
			<MemoryResurface memory={data.memory} viewerId={data.me.id} {partnerName} />
		</section>
	{/if}

	<!-- 7. Ghost mode 開關 (僅未隱身時; 已隱身用上方 banner 解除) -->
	{#if !ghostOn}
		<section class="mt-6">
			<button
				type="button"
				class="flex w-full items-center justify-between rounded-full border border-base-content/5 bg-base-200 px-4 py-3 text-left text-sm text-base-content transition-colors hover:bg-base-300/60 disabled:opacity-50"
				onclick={toggleGhost}
				disabled={ghostBusy}
			>
				<span>
					<span class="font-semibold">{m.settings_ghost_label()}</span>
					<span class="ml-2 text-xs text-base-content/50">{m.pulse_ghost_pause()}</span>
				</span>
				<span class="text-xs font-semibold tracking-wider text-primary uppercase"
					>{m.pulse_enable()}</span
				>
			</button>
		</section>
	{/if}

	<!-- 8. tracker 狀態提示 -->
	{#if tracker.status === 'denied'}
		<div role="alert" class="mt-4 rounded-2xl bg-base-200 p-3 text-xs text-base-content/70">
			{m.pulse_perm_denied()}
		</div>
	{:else if tracker.status === 'unsupported'}
		<div role="alert" class="mt-4 rounded-2xl bg-base-200 p-3 text-xs text-error">
			{m.pulse_perm_unsupported()}
		</div>
	{:else if tracker.status === 'requesting_permission'}
		<p class="mt-4 text-center text-xs text-base-content/60">{m.pulse_perm_requesting()}</p>
	{:else if tracker.status === 'error' && tracker.lastError}
		<p class="mt-4 text-center text-[11px] text-base-content/50">
			{m.pulse_sync_error({ detail: tracker.lastError })}
		</p>
	{/if}

	<!-- 9. partner 心跳 echo -->
	{#if tapPulse}
		{#key tapPulse}
			<p class="animate-bloom mt-4 text-center text-sm text-primary">
				{partnerName} tapped you 💞
			</p>
		{/key}
	{/if}
</main>

<!-- 10. 底部固定 HeartbeatZone (在 BottomNav 之上由 layout 負責 padding) -->
<div
	class="fixed right-0 bottom-0 left-0 z-20 mx-auto max-w-md bg-base-100/80 backdrop-blur"
	style="padding-bottom: calc(env(safe-area-inset-bottom) + 4.5rem);"
	aria-hidden="false"
>
	<HeartbeatZone onTap={sendTap} />
</div>
