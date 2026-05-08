<!--
  MomentCard — a single geo-moment in the timeline.

  Two visual variants gated by the `locked` prop:

  - locked: body is hidden (server enforces this via RLS — body sits in
    geo_moment_body, only readable by the author or once unlock is
    earned). We render a blurred plate with a CTA showing how much
    further the viewer needs to walk.

  - unlocked: full body, author tag, time, and the place hint (lat/lon
    rounded for poetry, not navigation — the actual map link is in
    the action footer).

  This component is presentational. The parent (/moments) is
  responsible for: distance computation, RLS-aware fetch, click-to-map.
-->
<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { MapPinIcon, NavigationArrowIcon } from '$lib/components/ui/icons';
	import LockSimpleIcon from 'phosphor-svelte/lib/LockSimpleIcon';
	import * as m from '$lib/paraglide/messages.js';

	type Props = {
		locked: boolean;
		authorIsViewer: boolean;
		authorName: string;
		body?: string | null;
		createdAt: Date | string;
		distanceFromViewerM?: number | null;
		radiusM: number;
		onOpenMap?: () => void;
	};

	let {
		locked,
		authorIsViewer,
		authorName,
		body = null,
		createdAt,
		distanceFromViewerM = null,
		radiusM,
		onOpenMap
	}: Props = $props();

	const created = $derived(typeof createdAt === 'string' ? new Date(createdAt) : createdAt);
	const dateLabel = $derived(
		created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
	);
	const timeLabel = $derived(
		created.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
	);

	const remainingM = $derived.by(() => {
		if (distanceFromViewerM == null) return null;
		const r = distanceFromViewerM - radiusM;
		return r > 0 ? Math.round(r) : 0;
	});
</script>

<article
	class="bg-base-200 shadow-paper border-base-content/5 relative overflow-hidden rounded-[var(--radius-card)] border"
>
	<header class="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2">
		<p class="text-base-content/60 text-[10px] tracking-[0.2em] uppercase">
			{authorIsViewer ? m.moment_card_you() : authorName}
		</p>
		<time class="text-base-content/50 text-xs"
			>{dateLabel} · <span class="text-base-content/40">{timeLabel}</span></time
		>
	</header>

	{#if locked}
		<div class="relative px-4 pb-4">
			<!-- blurred placeholder body -->
			<p
				class="text-base-content/30 select-none text-sm leading-relaxed"
				style="filter: blur(6px) saturate(0.6);"
				aria-hidden="true"
			>
				{m.moment_card_locked_lorem()}
			</p>
			<div class="bg-base-200/85 absolute inset-0 grid place-items-center backdrop-blur-sm">
				<div class="text-center">
					<Icon
						icon={LockSimpleIcon}
						size={28}
						weight="duotone"
						class="text-base-content/50 mx-auto"
					/>
					<p class="text-base-content/70 mt-2 text-sm">
						{#if remainingM != null && remainingM > 0}
							{m.moment_card_locked_walk_closer({ distance: remainingM })}
						{:else if remainingM === 0}
							{m.moment_card_locked_within_range()}
						{:else}
							{m.moment_card_locked_hint()}
						{/if}
					</p>
				</div>
			</div>
		</div>
	{:else}
		<p class="text-base-content px-4 pb-3 text-sm leading-relaxed whitespace-pre-wrap">
			{body ?? ''}
		</p>
	{/if}

	<footer class="border-base-content/5 flex items-center justify-between border-t px-4 py-2">
		<span class="text-base-content/50 inline-flex items-center gap-1 text-xs">
			<Icon icon={MapPinIcon} size={14} weight="duotone" />
			{m.moment_card_radius({ radiusM })}
		</span>
		{#if onOpenMap}
			<button
				type="button"
				class="text-primary inline-flex items-center gap-1 text-xs font-semibold tracking-wider uppercase hover:underline"
				onclick={onOpenMap}
			>
				<Icon icon={NavigationArrowIcon} size={14} weight="duotone" /> map
			</button>
		{/if}
	</footer>
</article>
