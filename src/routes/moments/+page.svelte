<!--
  /moments — timeline of geo-moments per design brief (U6c).

  Server returns full list (mine + partner's, body present only when
  unlocked or authored by me). Page renders MomentCard cards in a
  vertical timeline grouped by year-month.

  Distance-from-viewer for locked CTA: we attempt one geolocation
  reading on mount (cached) so the locked card can show "再走近 Xm".
  No streaming — this screen is read-mostly. Realtime invalidates
  whole list on partner moment events.
-->
<script lang="ts">
	import { invalidateAll, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount, onDestroy, untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { createRealtimeClient } from '$lib/client/realtime.svelte';
	import { MomentCard } from '$lib/components/duosync';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();
	const rt = createRealtimeClient(untrack(() => ({ coupleId: data.coupleId, userId: data.me.id })));

	let viewerLat = $state<number | null>(null);
	let viewerLon = $state<number | null>(null);
	let busyDelete = $state<string | null>(null);

	onMount(() => {
		void rt.start();
		// 一次性 fix, 用作 locked CTA 之距離提示. 不訂閱.
		if ('geolocation' in navigator) {
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					viewerLat = pos.coords.latitude;
					viewerLon = pos.coords.longitude;
				},
				() => {},
				{ enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 }
			);
		}
	});
	onDestroy(() => {
		void rt.stop();
	});

	$effect(() => {
		if (rt.lastMomentEvent) void invalidateAll();
	});

	function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
		const R = 6_371_000;
		const φ1 = (aLat * Math.PI) / 180;
		const φ2 = (bLat * Math.PI) / 180;
		const dφ = ((bLat - aLat) * Math.PI) / 180;
		const dλ = ((bLon - aLon) * Math.PI) / 180;
		const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
		return 2 * R * Math.asin(Math.sqrt(h));
	}

	type M = (typeof data.moments)[number];

	function distanceFor(m: M): number | null {
		if (viewerLat == null || viewerLon == null) return null;
		return haversineM(viewerLat, viewerLon, m.lat, m.lon);
	}

	// 分組按年月.
	type Group = { key: string; label: string; items: M[] };
	const groups = $derived.by<Group[]>(() => {
		const out: Group[] = [];
		let last: string | null = null;
		for (const m of data.moments) {
			const d = new Date(m.createdAt);
			const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
			const label = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
			if (key !== last) {
				out.push({ key, label, items: [] });
				last = key;
			}
			out[out.length - 1].items.push(m);
		}
		return out;
	});

	async function remove(id: string) {
		busyDelete = id;
		try {
			await fetch(`/api/moments/${id}`, { method: 'DELETE' });
			await invalidateAll();
		} finally {
			busyDelete = null;
		}
	}

	function openMap(m: M) {
		// 暫: 跳 /map 帶 query, /map 後續 (U6b) 解析.
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- destination already wrapped via resolve('/map')
		goto(resolve('/map') + `?focus=${m.id}&lat=${m.lat}&lon=${m.lon}`);
	}
</script>

<svelte:head>
	<title>{m.moments_title()} · DuoSync</title>
</svelte:head>

<div class="min-h-screen bg-base-100">
	<header
		class="sticky top-0 z-10 mx-auto flex max-w-md items-baseline justify-between bg-base-100/85 px-5 py-4 backdrop-blur"
	>
		<h1 class="text-display text-2xl font-semibold tracking-wide">{m.moments_title()}</h1>
		<a
			href={resolve('/moments/new')}
			class="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold tracking-wider text-primary-content uppercase shadow-paper"
		>
			<Icon icon={PlusIcon} size={14} weight="bold" />
			{m.moments_drop_button()}
		</a>
	</header>

	<main class="mx-auto max-w-md px-5 pb-32">
		{#if data.moments.length === 0}
			<div
				class="mt-12 grid place-items-center rounded-[var(--radius-card)] border border-dashed border-base-content/10 py-16 text-center"
			>
				<Icon icon={SparkleIcon} size={36} weight="duotone" class="text-primary/60" />
				<p class="mt-3 max-w-[14rem] text-sm text-base-content/70">
					{m.moments_empty_long({ plus: `+ ${m.moments_drop_button()}` })}
				</p>
			</div>
		{:else}
			<div class="mt-2 space-y-8">
				{#each groups as g (g.key)}
					<section>
						<p class="mb-3 text-[10px] tracking-[0.2em] text-base-content/40 uppercase">
							{g.label}
						</p>
						<ul class="space-y-3">
							{#each g.items as moment (moment.id)}
								{@const locked = !moment.isMine && moment.unlockedAt == null}
								<li class="relative">
									<MomentCard
										{locked}
										authorIsViewer={moment.isMine}
										authorName={data.partnerName}
										body={moment.body}
										createdAt={moment.createdAt}
										radiusM={moment.radiusM}
										distanceFromViewerM={distanceFor(moment)}
										onOpenMap={() => openMap(moment)}
									/>
									{#if moment.isMine}
										<button
											type="button"
											class="absolute top-3 right-12 text-xs text-base-content/40 hover:text-error"
											disabled={busyDelete === moment.id}
											onclick={() => remove(moment.id)}
											aria-label={m.moments_delete_aria()}
										>
											{busyDelete === moment.id ? '...' : '✕'}
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		{/if}
	</main>
</div>
