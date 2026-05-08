<!--
  /map — shared 2D map (U6b).

  Honours user theme (set in /settings) over the route default. When
  the user has no preference, /map defaults to dark via ROUTE_THEME in
  +layout.svelte. Tile layer is swapped reactively when the effective
  theme changes: CartoDB dark_all (dark) / light_all (light), no API
  key. Attribution credited bottom-right.

  Two pulsing pins (me / partner). When both have a fix, a polyline
  connects them with the distance label centered. Center FAB
  refits both pins. If partner is ghost we show only my pin and a
  tasteful banner.

  Leaflet is dynamically imported on mount (SSR-safe).

  ?focus=&lat=&lon= query (used by /moments openMap) re-centers on
  that point when present.
-->
<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/ui/Icon.svelte';
	import CrosshairIcon from 'phosphor-svelte/lib/CrosshairIcon';
	import GhostIcon from 'phosphor-svelte/lib/GhostIcon';
	import { themeState } from '$lib/theme/index.svelte';
	import type { PageData } from './$types';
	import 'leaflet/dist/leaflet.css';

	const { data }: { data: PageData } = $props();

	let mapEl = $state<HTMLDivElement | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let map: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let mePin: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let partnerPin: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let connector: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let tileLayer: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let leaflet: typeof import('leaflet') | null = null;

	function tileUrlFor(theme: 'duosync-light' | 'duosync-dark'): string {
		// CartoDB Positron (light) / Dark Matter (dark) — both warm-toned
		// minimalist raster tiles, no API key, attribution required.
		return theme === 'duosync-dark'
			? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
			: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
	}

	function applyTileLayer(theme: 'duosync-light' | 'duosync-dark') {
		if (!leaflet || !map) return;
		const next = leaflet.tileLayer(tileUrlFor(theme), {
			subdomains: 'abcd',
			maxZoom: 19
		});
		next.addTo(map);
		if (tileLayer) map.removeLayer(tileLayer);
		tileLayer = next;
	}

	function buildPinIcon(L: typeof import('leaflet'), emoji: string, color: string) {
		return L.divIcon({
			className: '',
			html: `
				<div class="duosync-pin">
					<span class="duosync-pin-pulse animate-map-pin-pulse" style="background:${color}"></span>
					<span class="duosync-pin-glyph">${emoji}</span>
				</div>
			`,
			iconSize: [44, 44],
			iconAnchor: [22, 22]
		});
	}

	async function init() {
		if (!mapEl) return;
		const L = await import('leaflet');
		leaflet = L;

		const fallback: [number, number] = [22.3193, 114.1694]; // 香港 placeholder
		const mePos: [number, number] | null =
			data.me.lat != null && data.me.lon != null ? [data.me.lat, data.me.lon] : null;
		const partnerPos: [number, number] | null =
			!data.partner.ghost && data.partner.lat != null && data.partner.lon != null
				? [data.partner.lat, data.partner.lon]
				: null;

		// 若有 ?focus= 之 lat/lon, 用之為中心.
		const focusLat = parseFloat(page.url.searchParams.get('lat') ?? '');
		const focusLon = parseFloat(page.url.searchParams.get('lon') ?? '');
		const focusPos: [number, number] | null =
			Number.isFinite(focusLat) && Number.isFinite(focusLon) ? [focusLat, focusLon] : null;

		map = L.map(mapEl, {
			zoomControl: false,
			attributionControl: false,
			preferCanvas: true
		}).setView(focusPos ?? mePos ?? partnerPos ?? fallback, 14);

		applyTileLayer(untrack(() => themeState.effective));

		L.control
			.attribution({ position: 'bottomright', prefix: false })
			.addAttribution('© OSM · CARTO')
			.addTo(map);

		if (mePos) {
			mePin = L.marker(mePos, {
				icon: buildPinIcon(L, data.me.avatarEmoji, 'var(--color-primary)')
			}).addTo(map);
		}
		if (partnerPos) {
			partnerPin = L.marker(partnerPos, {
				icon: buildPinIcon(L, data.partner.avatarEmoji, 'var(--color-secondary)')
			}).addTo(map);
		}

		if (mePos && partnerPos) {
			connector = L.polyline([mePos, partnerPos], {
				color: 'rgba(244, 177, 160, 0.5)',
				weight: 2,
				dashArray: '6 8'
			}).addTo(map);
		}

		if (focusPos) {
			L.circle(focusPos, {
				radius: 60,
				color: 'var(--color-accent)',
				weight: 2,
				fillOpacity: 0.15
			}).addTo(map);
		}
	}

	// React to theme changes (user toggle in /settings, OS pref change).
	$effect(() => {
		const t = themeState.effective;
		if (map && leaflet) applyTileLayer(t);
	});

	function fitBoth() {
		if (!map) return;
		const pts: [number, number][] = [];
		if (data.me.lat != null && data.me.lon != null) pts.push([data.me.lat, data.me.lon]);
		if (!data.partner.ghost && data.partner.lat != null && data.partner.lon != null)
			pts.push([data.partner.lat, data.partner.lon]);
		if (pts.length === 0) return;
		if (pts.length === 1) {
			map.setView(pts[0], 14);
			return;
		}
		map.fitBounds(pts, { padding: [60, 60], maxZoom: 15 });
	}

	onMount(() => {
		void init();
	});
	onDestroy(() => {
		if (map) {
			map.remove();
			map = null;
		}
		tileLayer = null;
		leaflet = null;
	});
</script>

<svelte:head>
	<title>{m.map_title()} · DuoSync</title>
</svelte:head>

<div class="fixed inset-0 bg-base-100">
	<div bind:this={mapEl} class="absolute inset-0"></div>

	{#if data.partner.ghost}
		<div
			class="absolute inset-x-0 top-4 mx-auto w-fit max-w-[18rem] rounded-full bg-base-200/85 px-4 py-2 text-center text-xs text-base-content/80 backdrop-blur"
		>
			<Icon icon={GhostIcon} size={14} weight="duotone" class="mr-1 inline align-text-bottom" />
			{m.map_partner_hidden({ name: data.partner.displayName })}
		</div>
	{/if}

	<button
		type="button"
		onclick={fitBoth}
		class="absolute right-5 bottom-28 z-10 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-content shadow-paper"
		aria-label={m.map_center_on_us()}
	>
		<Icon icon={CrosshairIcon} size={22} weight="duotone" />
	</button>
</div>

<style>
	:global(.duosync-pin) {
		position: relative;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
	}
	:global(.duosync-pin-pulse) {
		position: absolute;
		inset: 0;
		border-radius: 9999px;
		opacity: 0.5;
	}
	:global(.duosync-pin-glyph) {
		position: relative;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		background: var(--color-base-100);
		border: 2px solid var(--color-base-content);
		border-radius: 9999px;
		font-size: 16px;
		line-height: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.duosync-pin-pulse) {
			opacity: 0.25;
		}
	}
</style>
