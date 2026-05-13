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
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import InputField from '$lib/components/ui/InputField.svelte';
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
			geoErr = m.moments_new_err_no_geo();
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
			saveErr = m.moments_new_err_no_fix();
			return;
		}
		const text = body.trim();
		if (text.length === 0) {
			saveErr = m.moments_new_err_empty();
			return;
		}
		busy = true;
		try {
			const payload = {
				lat,
				lon,
				radiusM,
				body: text,
				expiresAt: expiryToIso()
			};
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				// Offline — persist for retry. We can't surface the server-
				// generated id yet, but the navigation back to /moments is
				// fine because the SW serves the cached list and the new
				// item will appear once the queue drains.
				const { enqueue } = await import('$lib/client/offline-queue');
				await enqueue('/api/moments', payload);
				await goto(resolve('/moments'));
				return;
			}
			const r = await fetch('/api/moments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!r.ok) {
				if (r.status >= 500) {
					const { enqueue } = await import('$lib/client/offline-queue');
					await enqueue('/api/moments', payload);
					await goto(resolve('/moments'));
					return;
				}
				const t = await r.text().catch(() => '');
				saveErr = m.moments_new_err_save({ status: r.status, detail: t });
				return;
			}
			await goto(resolve('/moments'));
		} finally {
			busy = false;
		}
	}

	const radiusPresets = [50, 100, 500];
</script>

<svelte:head>
	<title>{m.moments_new_title()} · DuoSync</title>
</svelte:head>

<div class="min-h-screen bg-base-100">
	<header
		class="sticky top-0 z-10 mx-auto flex max-w-md items-center justify-between bg-base-100/85 px-5 py-4 backdrop-blur"
	>
		<a class="text-xs tracking-wider text-base-content/60 uppercase" href={resolve('/moments')}
			>{m.common_cancel()}</a
		>
		<h1 class="text-display text-lg font-semibold">{m.moments_new_title()}</h1>
		<span class="w-10"></span>
	</header>

	<main class="mx-auto max-w-md px-5 pb-32">
		<!-- mini map preview -->
		<div
			class="relative mt-2 h-44 overflow-hidden rounded-[var(--radius-card)] border border-base-content/10 bg-base-200"
		>
			<div bind:this={mapEl} class="absolute inset-0"></div>
			{#if lat == null}
				<div class="absolute inset-0 grid place-items-center text-xs text-base-content/50">
					{m.moments_new_capture_pending()}
				</div>
			{/if}
			<button
				type="button"
				onclick={captureFix}
				class="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-full bg-base-100/85 px-3 py-1.5 text-[10px] font-semibold tracking-wider text-base-content uppercase shadow-paper backdrop-blur"
			>
				<Icon icon={CrosshairIcon} size={12} weight="duotone" />
				{m.moments_new_recenter()}
			</button>
		</div>

		{#if lat != null && lon != null}
			<p class="mt-2 text-[11px] text-base-content/40">
				{lat.toFixed(5)}, {lon.toFixed(5)}{#if accuracyM != null}
					· ±{Math.round(accuracyM)}m{/if}
			</p>
		{/if}
		{#if geoErr}
			<div class="mt-2 rounded-[var(--radius-card)] bg-error/10 px-3 py-2 text-xs text-error">
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
					label={m.moments_new_radius_m()}
					formatValue={(v) => `${v}m`}
				/>
			</section>

			<!-- caption -->
			<section>
				<div class="mb-1.5 flex items-baseline justify-between">
					<span class="text-xs tracking-wider text-base-content/70 uppercase"
						>{m.moments_new_caption_label()}</span
					>
					<span class="text-[10px] text-base-content/40">{body.length}/280</span>
				</div>
				<InputField
					bind:value={body}
					maxlength={280}
					rows={4}
					placeholder={m.moments_new_caption_placeholder()}
				/>
			</section>

			<!-- expiry -->
			<section>
				<p class="mb-2 text-xs tracking-wider text-base-content/70 uppercase">
					{m.moments_new_expiry_label()}
				</p>
				<div class="flex gap-2">
					{#each [{ k: 'none' as const, label: m.moments_new_expiry_never() }, { k: '24h' as const, label: '24h' }, { k: '7d' as const, label: '7d' }] as o (o.k)}
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
				<div class="rounded-[var(--radius-card)] bg-error/10 px-3 py-2 text-sm text-error">
					{saveErr}
				</div>
			{/if}

			<PillButton type="submit" size="lg" block disabled={busy} class="gap-2">
				<Icon icon={SparkleIcon} size={18} weight="duotone" />
				{busy ? m.moments_new_dropping() : m.moments_new_drop_here()}
			</PillButton>
		</form>
	</main>
</div>
