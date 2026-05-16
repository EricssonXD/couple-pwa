<!--
	HourListSheet — F11 U7.

	BottomSheet listing today's 24 hours. Used by the pager as a quick
	jump alternative to chevron stepping or swipe. Each row shows the
	hour label and a tiny status dot (you / partner clip presence).
	Future hours are disabled.
-->
<script lang="ts">
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import { hourLabel, isCurrentHour, isFuture } from '$lib/hourly/dayNav';
	import type { PagerCell } from '$lib/hourly/types';

	interface Props {
		open: boolean;
		buckets: string[];
		youCells: Record<string, PagerCell>;
		partnerCells: Record<string, PagerCell>;
		selectedBucket: string;
		locale?: string;
		onselect: (bucket: string) => void;
		onclose: () => void;
	}

	let {
		open = $bindable(),
		buckets,
		youCells,
		partnerCells,
		selectedBucket,
		locale = typeof navigator !== 'undefined' ? navigator.language : 'en',
		onselect,
		onclose
	}: Props = $props();

	function pick(b: string): void {
		onselect(b);
		open = false;
		onclose();
	}
</script>

<BottomSheet bind:open title="">
	<ul class="divide-y divide-base-content/10">
		{#each buckets as bucket (bucket)}
			{@const you = youCells[bucket]}
			{@const partner = partnerCells[bucket]}
			{@const future = isFuture(bucket)}
			{@const current = isCurrentHour(bucket)}
			{@const selected = bucket === selectedBucket}
			<li>
				<button
					type="button"
					class="flex w-full items-center justify-between gap-3 px-2 py-3 text-left disabled:opacity-40 {selected
						? 'bg-primary/10'
						: 'hover:bg-base-200'}"
					disabled={future}
					onclick={() => pick(bucket)}
				>
					<span class="flex items-center gap-2 text-sm tabular-nums">
						{hourLabel(bucket, locale)}
						{#if current}
							<span
								class="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold tracking-wide text-primary uppercase"
							>
								now
							</span>
						{/if}
					</span>
					<span class="flex items-center gap-1.5">
						<span
							class="h-2 w-2 rounded-full {you?.clip ? 'bg-primary' : 'bg-base-content/15'}"
							aria-label={you?.clip ? 'you captured' : 'you empty'}
						></span>
						<span
							class="h-2 w-2 rounded-full {partner?.clip ? 'bg-secondary' : 'bg-base-content/15'}"
							aria-label={partner?.clip ? 'partner captured' : 'partner empty'}
						></span>
					</span>
				</button>
			</li>
		{/each}
	</ul>
</BottomSheet>
