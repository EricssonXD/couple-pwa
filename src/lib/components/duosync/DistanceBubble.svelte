<!--
  DistanceBubble — the centerpiece of /pulse.

  Big breathing ring. Color encodes the distance bucket so users on
  prefers-reduced-motion (which disables the breath) still get the
  signal via hue + sub-label. Numeral uses Fraunces (.text-display)
  for the soft, paper-press feel from the brief.

  Props:
    distanceM  meters between partners; null while waiting for first fix
    bucket     server-derived bucket: together|near|same_city|far|unknown
    ghost      true when either partner is in ghost mode — overrides
               the bucket ring color with --distance-ghost slate

  Sizing: width is `clamp(15rem, 70vw, 22rem)` — keeps the bubble
  generous on phones, never explodes on tablets.
-->
<script lang="ts">
	import type { DistanceBucket } from '$lib/server/services/location';

	type Props = {
		distanceM: number | null;
		bucket: DistanceBucket;
		ghost?: boolean;
	};

	let { distanceM, bucket, ghost = false }: Props = $props();

	const labels: Record<DistanceBucket, { primary: string; sub: string }> = {
		together: { primary: '同處', sub: 'Together' },
		near: { primary: '近', sub: 'Nearby' },
		same_city: { primary: '同城', sub: 'Same city' },
		far: { primary: '遠', sub: 'Apart' },
		unknown: { primary: '?', sub: 'Waiting for fix' }
	};

	const ringColorVar = $derived(ghost ? '--distance-ghost' : `--distance-${bucketKey(bucket)}`);
	const display = $derived(ghost ? { primary: '隱', sub: 'Ghost mode' } : labels[bucket]);

	const numeral = $derived.by(() => {
		if (ghost || distanceM == null) return null;
		if (distanceM < 1000) return { value: Math.round(distanceM), unit: 'm' };
		if (distanceM < 10_000) return { value: (distanceM / 1000).toFixed(1), unit: 'km' };
		return { value: Math.round(distanceM / 1000), unit: 'km' };
	});

	function bucketKey(b: DistanceBucket): 'same' | 'near' | 'city' | 'far' | 'ghost' {
		switch (b) {
			case 'together':
				return 'same';
			case 'near':
				return 'near';
			case 'same_city':
				return 'city';
			case 'far':
				return 'far';
			case 'unknown':
				return 'ghost';
		}
	}
</script>

<div
	class="relative mx-auto grid place-items-center"
	style="width: clamp(15rem, 70vw, 22rem); aspect-ratio: 1 / 1;"
	aria-live="polite"
>
	<!-- Outer breathing ring -->
	<div
		class="animate-breathe absolute inset-0 rounded-full"
		style="background: radial-gradient(circle at 30% 30%, color-mix(in oklab, var({ringColorVar}) 30%, transparent), transparent 70%);"
	></div>

	<!-- Solid ring border -->
	<div
		class="absolute inset-2 rounded-full border-[6px] opacity-80"
		style="border-color: var({ringColorVar});"
	></div>

	<!-- Inner paper card -->
	<div
		class="bg-base-200 shadow-paper relative grid h-[78%] w-[78%] place-items-center rounded-full text-center"
	>
		<div>
			{#if numeral}
				<p class="text-display text-base-content text-6xl leading-none font-semibold">
					{numeral.value}<span class="text-base-content/50 ml-1 text-2xl font-normal"
						>{numeral.unit}</span
					>
				</p>
			{:else}
				<p class="text-display text-base-content text-7xl leading-none font-semibold">
					{display.primary}
				</p>
			{/if}
			<p class="text-base-content/60 mt-2 text-xs tracking-[0.2em] uppercase">
				{display.sub}
			</p>
		</div>
	</div>
</div>
