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
	import { resolve } from '$app/paths';
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
		MemoryResurface,
		HeartbeatZone,
		StreakBadge,
		MoodPicker
	} from '$lib/components/duosync';
	import type { DistanceBucket } from '$lib/server/services/location';
	import type { Mood, MoodSnapshot } from '$lib/server/services/mood';
	import type { PageData } from './$types';

	const MOOD_EMOJI: Record<Mood, string> = {
		joyful: '😄',
		happy: '😊',
		neutral: '😐',
		sad: '😔',
		upset: '😢'
	};
	const MOOD_LABEL_KEY: Record<Mood, () => string> = {
		joyful: m.mood_pick_joyful,
		happy: m.mood_pick_happy,
		neutral: m.mood_pick_neutral,
		sad: m.mood_pick_sad,
		upset: m.mood_pick_upset
	};

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
	// Ghost mode is read-only on /pulse — toggle lives in /settings.
	// We still track it locally so the geolocation tracker pauses and
	// the user's own avatar shows the ghost presence dot.
	let ghostOn = $state(untrack(() => data.me.ghostMode));
	let now = $state(Date.now());
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;
	let tapPulse = $state(0);
	let selfTapPulse = $state(0);
	let myMood = $state<MoodSnapshot | null>(untrack(() => data.myMood));
	let partnerMood = $state<MoodSnapshot | null>(untrack(() => data.partnerMood));
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

	// realtime: partner mood update
	$effect(() => {
		const mood = rt.lastMood;
		if (!mood || mood.userId !== partnerId) return;
		partnerMood = { mood: mood.mood, setAt: mood.setAt };
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

	let lastSendAt = 0;
	function sendTap() {
		// 1s throttle 防連觸
		const t = Date.now();
		if (t - lastSendAt < 1000) return;
		lastSendAt = t;
		void rt.sendHeartbeatTap();
		selfTapPulse = t;
		// HeartbeatZone 已 vibrate(TAP_HEARTBEAT); 無需再震
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
	<!-- 1. Top chrome: ribbon (taps through to /timeline) + streak badge -->
	<header>
		<a
			href={resolve('/timeline')}
			class="block rounded-full transition hover:opacity-90"
			aria-label={m.pulse_open_timeline()}
		>
			<AnniversaryRibbon
				coupleSince={data.coupleSince}
				anniversary={data.anniversary}
				nickname={data.coupleNickname}
			/>
		</a>
		{#if data.streak && data.streak.current > 0}
			<div class="mt-2 flex justify-center">
				<StreakBadge streak={data.streak.current} />
			</div>
		{/if}
	</header>

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
			<div class="relative flex justify-center">
				<PartnerAvatar
					displayName={partnerName}
					avatarEmoji={data.partner?.avatarEmoji ?? '🌱'}
					presence={partnerAvatarPresence}
					batteryPct={partnerBattery}
					charging={partnerCharging}
					size={64}
				/>
				{#if partnerMood}
					<span
						class="absolute -right-1 bottom-0 flex h-7 w-7 items-center justify-center rounded-full bg-base-100 text-base shadow-paper"
						title={m.mood_partner_feels({
							name: partnerName,
							mood: MOOD_LABEL_KEY[partnerMood.mood]()
						})}
						aria-label={m.mood_partner_feels({
							name: partnerName,
							mood: MOOD_LABEL_KEY[partnerMood.mood]()
						})}
					>
						<span aria-hidden="true">{MOOD_EMOJI[partnerMood.mood]}</span>
					</span>
				{/if}
			</div>
			<p class="mt-2 text-xs font-semibold text-base-content">{partnerName}</p>
			<p class="text-[11px] text-base-content/50">
				{partnerGhost ? m.pulse_partner_hidden() : partnerLastSeen || m.pulse_no_fix()}
			</p>
		</article>
	</section>

	<!-- 5b. Mood picker (F5) -->
	<section class="mt-4">
		<MoodPicker
			current={myMood?.mood ?? null}
			online={net.online}
			onChange={(mood) => {
				myMood = { mood, setAt: new Date().toISOString() };
			}}
		/>
	</section>

	<!-- 6. Memory Resurface (如有) -->
	{#if data.memory}
		<section class="mt-6">
			<MemoryResurface memory={data.memory} viewerId={data.me.id} {partnerName} />
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

	<!-- 9. partner 心跳 echo (aria-live polite so SR reads new taps) -->
	<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">
		{#if tapPulse}{m.pulse_partner_tapped({ name: partnerName })}{/if}
		{#if selfTapPulse}{m.pulse_self_tapped({ name: partnerName })}{/if}
	</div>
	{#if tapPulse}
		{#key tapPulse}
			<p class="animate-bloom mt-4 text-center text-sm text-primary" aria-hidden="true">
				{m.pulse_partner_tapped({ name: partnerName })}
			</p>
		{/key}
	{/if}
	{#if selfTapPulse}
		{#key selfTapPulse}
			<p class="animate-bloom mt-2 text-center text-sm text-secondary" aria-hidden="true">
				{m.pulse_self_tapped({ name: partnerName })}
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
