<!--
  /moments/new — geo-moment composer (U6d).

  Forced dark-theme via +layout.svelte ROUTE_THEME match.

  Flow per brief:
    1. Top: mini Leaflet preview (read-only) of current fix + radius
       circle. Pin is the user's current location (auto-captured on
       mount; can re-capture).
    2. Radius slider (50 / 100 / 500 m chips + free range slider for
       custom).
    3. Caption textarea (280 char cap).
    4. Expiry chips (none / 24h / 7d).
    5. Big rose "Drop here ✨" CTA pill.

  No image picker yet — server doesn't accept media (geoMomentBody
  is text-only). Punted to a v1.1 once Storage lands.

  POST contract identical: { lat, lon, radiusM, body, expiresAt? } →
  /api/moments. Server already validates expiresAt is in the future.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Slider from '$lib/components/ui/Slider.svelte';
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import CrosshairIcon from 'phosphor-svelte/lib/CrosshairIcon';
	import 'leaflet/dist/leaflet.css';

	let lat = $state<number | null>(null);
	let lon = $state<number | null>(null);
	let accuracyM = $state<number | null>(null);
	let radius = $state<number[]>([100]);
	const radiusM = $derived(radius[0]);
	let body = $state('');
	let expiry = $state<'none' | '24h' | '7d'>('none');
	let busy = $state(false);
	let geoErr = $state<string | null>(null);
	let saveErr = $state<string | null>(null);

	let mapEl = $state<HTMLDivElement | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let map: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let pin: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let circle: any = null;

	function captureFix() {
		geoErr = null;
		if (!('geolocation' in navigator)) {
			geoErr = '此瀏覽器無位置權限.';
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				lat = pos.coords.latitude;
				lon = pos.coords.longitude;
				accuracyM = pos.coords.accuracy;
			},
			(err) => {
				geoErr = err.message;
			},
			{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
		);
	}

	async function initMap() {
		if (!mapEl || lat == null || lon == null || map) return;
		const L = await import('leaflet');
		map = L.map(mapEl, {
			zoomControl: false,
			attributionControl: false,
			dragging: false,
			scrollWheelZoom: false,
			doubleClickZoom: false,
			touchZoom: false
		}).setView([lat, lon], 16);
		L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
			subdomains: 'abcd'
		}).addTo(map);
		pin = L.circleMarker([lat, lon], {
			color: 'var(--color-primary)',
			fillColor: 'var(--color-primary)',
			fillOpacity: 1,
			radius: 6,
			weight: 2
		}).addTo(map);
		circle = L.circle([lat, lon], {
			radius: radiusM,
			color: 'var(--color-primary)',
			weight: 1.5,
			fillOpacity: 0.12
		}).addTo(map);
	}

	$effect(() => {
		if (lat != null && lon != null) {
			if (!map) void initMap();
			else {
				map.setView([lat, lon], 16);
				if (pin) pin.setLatLng([lat, lon]);
				if (circle) circle.setLatLng([lat, lon]);
			}
		}
	});

	$effect(() => {
		if (circle) circle.setRadius(radiusM);
	});

	onMount(() => {
		captureFix();
	});
	onDestroy(() => {
		if (map) {
			map.remove();
			map = null;
		}
	});

	function expiryToIso(): string | undefined {
		if (expiry === 'none') return undefined;
		const ms = expiry === '24h' ? 86_400_000 : 7 * 86_400_000;
		return new Date(Date.now() + ms).toISOString();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		saveErr = null;
		if (lat == null || lon == null) {
			saveErr = '先取位置.';
			return;
		}
		const text = body.trim();
		if (text.length === 0) {
			saveErr = '寫點什麼.';
			return;
		}
		busy = true;
		try {
			const r = await fetch('/api/moments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					lat,
					lon,
					radiusM,
					body: text,
					expiresAt: expiryToIso()
				})
			});
			if (!r.ok) {
				const t = await r.text().catch(() => '');
				saveErr = `保存失敗: ${r.status} ${t}`;
				return;
			}
			await goto('/moments');
		} finally {
			busy = false;
		}
	}

	const radiusPresets = [50, 100, 500];
</script>

<svelte:head>
	<title>留下時刻 · DuoSync</title>
</svelte:head>

<div class="bg-base-100 min-h-screen">
	<header
		class="bg-base-100/85 sticky top-0 z-10 mx-auto flex max-w-md items-center justify-between px-5 py-4 backdrop-blur"
	>
		<a class="text-base-content/60 text-xs tracking-wider uppercase" href="/moments">取消</a>
		<h1 class="text-display text-lg font-semibold">留下時刻</h1>
		<span class="w-10"></span>
	</header>

	<main class="mx-auto max-w-md px-5 pb-32">
		<!-- mini map preview -->
		<div
			class="bg-base-200 border-base-content/10 relative mt-2 h-44 overflow-hidden rounded-[var(--radius-card)] border"
		>
			<div bind:this={mapEl} class="absolute inset-0"></div>
			{#if lat == null}
				<div class="text-base-content/50 absolute inset-0 grid place-items-center text-xs">
					取位置中…
				</div>
			{/if}
			<button
				type="button"
				onclick={captureFix}
				class="bg-base-100/85 text-base-content shadow-paper absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase backdrop-blur"
			>
				<Icon icon={CrosshairIcon} size={12} weight="duotone" /> recenter
			</button>
		</div>

		{#if lat != null && lon != null}
			<p class="text-base-content/40 mt-2 text-[11px]">
				{lat.toFixed(5)}, {lon.toFixed(5)}{#if accuracyM != null} · ±{Math.round(accuracyM)}m{/if}
			</p>
		{/if}
		{#if geoErr}
			<div class="bg-error/10 text-error mt-2 rounded-[var(--radius-card)] px-3 py-2 text-xs">
				{geoErr}
			</div>
		{/if}

		<form class="mt-6 space-y-6" onsubmit={submit}>
			<!-- radius -->
			<section>
				<div class="mb-2 flex gap-2">
					{#each radiusPresets as r (r)}
						<button
							type="button"
							onclick={() => (radius = [r])}
							class="rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wider uppercase {radiusM ===
							r
								? 'border-primary bg-primary/10 text-primary'
								: 'border-base-content/10 text-base-content/60'}"
						>
							{r}m
						</button>
					{/each}
				</div>
				<Slider
					bind:value={radius}
					min={30}
					max={1000}
					step={10}
					label="解鎖半徑"
					formatValue={(v) => `${v}m`}
				/>
			</section>

			<!-- caption -->
			<section>
				<div class="mb-1.5 flex items-baseline justify-between">
					<span class="text-base-content/70 text-xs tracking-wider uppercase">心意</span>
					<span class="text-base-content/40 text-[10px]">{body.length}/280</span>
				</div>
				<textarea
					bind:value={body}
					maxlength="280"
					rows="4"
					class="bg-base-200 border-base-content/10 focus:border-primary w-full resize-none rounded-[var(--radius-card)] border px-4 py-3 text-base outline-none"
					placeholder="留一段, 等對方走到時讀到…"
				></textarea>
			</section>

			<!-- expiry -->
			<section>
				<p class="text-base-content/70 mb-2 text-xs tracking-wider uppercase">何時過期</p>
				<div class="flex gap-2">
					{#each [{ k: 'none' as const, label: '永久' }, { k: '24h' as const, label: '24h' }, { k: '7d' as const, label: '7d' }] as o (o.k)}
						<button
							type="button"
							onclick={() => (expiry = o.k)}
							class="flex-1 rounded-full border px-3 py-2 text-xs font-semibold tracking-wider uppercase {expiry ===
							o.k
								? 'border-primary bg-primary/10 text-primary'
								: 'border-base-content/10 text-base-content/60'}"
						>
							{o.label}
						</button>
					{/each}
				</div>
			</section>

			{#if saveErr}
				<div class="bg-error/10 text-error rounded-[var(--radius-card)] px-3 py-2 text-sm">
					{saveErr}
				</div>
			{/if}

			<button
				type="submit"
				disabled={busy}
				class="bg-primary text-primary-content shadow-paper inline-flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-base font-semibold tracking-wider uppercase transition-transform active:scale-[0.98] disabled:opacity-50"
			>
				<Icon icon={SparkleIcon} size={18} weight="duotone" />
				{busy ? '留下中…' : 'drop here ✨'}
			</button>
		</form>
	</main>
</div>
