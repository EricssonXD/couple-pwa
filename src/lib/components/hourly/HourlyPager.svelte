<!--
	HourlyPager — F11 U4.

	Setlog-style single-hour pager. Renders two stacked 16:9 HourTile
	(you on top, partner on bottom) for the currently selected hour
	bucket, with a top pager bar (◀ time ▶) and horizontal swipe
	gestures to step between hours.

	Pure presentational: parent owns the day payload + currently
	selected bucket, the recorder lifecycle, and any data loading. The
	pager only emits navigation intents.

	Future hours are clamped — the next-hour control is disabled when
	`selectedBucket` is already the current hour. Past-day browsing is
	allowed (parent decides how far back to load), with boundary chips
	left to U7.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
	import HourTile from './HourTile.svelte';
	import type { PagerCell, TileClip } from '$lib/hourly/types';
	import {
		currentBucket,
		hourLabel,
		isCurrentHour,
		isFuture,
		nextHour,
		prevHour,
		relativeLabel
	} from '$lib/hourly/dayNav';

	interface Props {
		selectedBucket: string;
		/** Map: bucket → your cell. Buckets not in the map render as empty. */
		youCells: Record<string, PagerCell>;
		partnerCells: Record<string, PagerCell>;
		/** Locale for the hour label (BCP 47). Defaults to browser-derived. */
		locale?: string;
		onselect: (bucket: string) => void;
		/** Tapped a clip — parent decides play/expand. */
		ontap?: (owner: 'you' | 'partner', clip: TileClip) => void;
		/** Tapped the empty current-hour your-tile. */
		oncapture?: () => void;
		/** Tapped the time label — parent may open a BottomSheet picker. */
		onpickhour?: () => void;
		/** Tapped "edit caption" in the current-hour your-tile menu. */
		oneditcaption?: (clip: TileClip) => void;
		/** Tapped "delete" in the current-hour your-tile menu. */
		ondelete?: (clip: TileClip) => void;
	}

	let {
		selectedBucket,
		youCells,
		partnerCells,
		locale = typeof navigator !== 'undefined' ? navigator.language : 'en',
		onselect,
		ontap,
		oncapture,
		onpickhour,
		oneditcaption,
		ondelete
	}: Props = $props();

	const isCurrent = $derived(isCurrentHour(selectedBucket));
	const canGoNext = $derived(!isFuture(nextHour(selectedBucket)));

	const youCell = $derived(youCells[selectedBucket] ?? null);
	const partnerCell = $derived(partnerCells[selectedBucket] ?? null);

	function goPrev(): void {
		onselect(prevHour(selectedBucket));
	}
	function goNext(): void {
		if (!canGoNext) return;
		onselect(nextHour(selectedBucket));
	}
	function goToday(): void {
		onselect(currentBucket());
	}

	const relLabel = $derived.by(() => {
		const r = relativeLabel(selectedBucket);
		switch (r.kind) {
			case 'now':
				return m.hourly_pager_relative_now();
			case 'hours_ago':
				return m.hourly_pager_relative_hours_ago({ n: r.n });
			case 'yesterday':
				return m.hourly_pager_relative_yesterday();
			case 'days_ago':
				return m.hourly_pager_relative_days_ago({ n: r.n });
			case 'future':
				return '';
		}
	});

	// Swipe gesture (touch only — desktop uses chevrons).
	let touchStartX = 0;
	let touchStartY = 0;
	let touchActive = false;
	const SWIPE_THRESHOLD_PX = 48;

	function onTouchStart(e: TouchEvent): void {
		const t = e.touches[0];
		if (!t) return;
		touchStartX = t.clientX;
		touchStartY = t.clientY;
		touchActive = true;
	}
	function onTouchEnd(e: TouchEvent): void {
		if (!touchActive) return;
		touchActive = false;
		const t = e.changedTouches[0];
		if (!t) return;
		const dx = t.clientX - touchStartX;
		const dy = t.clientY - touchStartY;
		if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
		if (Math.abs(dy) > Math.abs(dx)) return;
		// swipe-left = advance to next hour; swipe-right = previous
		if (dx < 0) goNext();
		else goPrev();
	}

	function onYouTap(): void {
		if (youCell?.clip) ontap?.('you', youCell.clip);
	}
	function onPartnerTap(): void {
		if (partnerCell?.clip) ontap?.('partner', partnerCell.clip);
	}
</script>

<div
	class="flex h-full w-full flex-col"
	ontouchstart={onTouchStart}
	ontouchend={onTouchEnd}
	role="region"
	aria-roledescription="hour pager"
	aria-label={hourLabel(selectedBucket, locale)}
>
	<header class="flex items-center justify-between gap-2 px-3 py-2">
		<button
			type="button"
			class="rounded-full p-2 hover:bg-base-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
			aria-label={m.hourly_pager_prev_hour()}
			onclick={goPrev}
		>
			<CaretLeftIcon size={20} />
		</button>

		<button
			type="button"
			class="flex flex-col items-center rounded-md px-3 py-1 hover:bg-base-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
			onclick={() => onpickhour?.()}
		>
			<span class="text-base font-semibold tabular-nums">
				{hourLabel(selectedBucket, locale)}
			</span>
			{#if relLabel}
				<span class="text-[10px] tracking-wide text-base-content/60 uppercase">{relLabel}</span>
			{/if}
		</button>

		<button
			type="button"
			class="rounded-full p-2 hover:bg-base-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-30"
			aria-label={m.hourly_pager_next_hour()}
			onclick={goNext}
			disabled={!canGoNext}
		>
			<CaretRightIcon size={20} />
		</button>
	</header>

	<div class="flex flex-1 flex-col gap-2 px-3 pb-3">
		<HourTile
			owner="you"
			isCurrentHour={isCurrent}
			clip={youCell?.clip ?? null}
			mood={youCell?.mood ?? null}
			ontap={onYouTap}
			oncapture={() => oncapture?.()}
			oneditcaption={() => youCell?.clip && oneditcaption?.(youCell.clip)}
			ondelete={() => youCell?.clip && ondelete?.(youCell.clip)}
		/>
		<HourTile
			owner="partner"
			isCurrentHour={isCurrent}
			clip={partnerCell?.clip ?? null}
			mood={partnerCell?.mood ?? null}
			ontap={onPartnerTap}
		/>
	</div>

	{#if !isCurrent}
		<footer class="flex justify-center px-3 pb-3">
			<button
				type="button"
				class="rounded-full bg-base-200 px-3 py-1 text-xs font-medium text-base-content/80 hover:bg-base-300"
				onclick={goToday}
			>
				{m.hourly_pager_jump_to_today()}
			</button>
		</footer>
	{/if}
</div>
