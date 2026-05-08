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
	import * as m from '$lib/paraglide/messages.js';

	type Props = {
		distanceM: number | null;
		bucket: DistanceBucket;
		ghost?: boolean;
	};

	let { distanceM, bucket, ghost = false }: Props = $props();

	const ringColorVar = $derived(ghost ? '--distance-ghost' : `--distance-${bucketKey(bucket)}`);
	const label = $derived(
		ghost
			? m.pulse_distance_ghost()
			: bucket === 'together'
				? m.pulse_distance_same()
				: bucket === 'near'
					? m.pulse_distance_near()
					: bucket === 'same_city'
						? m.pulse_distance_city()
						: bucket === 'far'
							? m.pulse_distance_far()
							: m.pulse_distance_unknown()
	);

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
		class="relative grid h-[78%] w-[78%] place-items-center rounded-full bg-base-200 text-center shadow-paper"
	>
		<div>
			{#if numeral}
				<p class="text-display text-6xl leading-none font-semibold text-base-content">
					{numeral.value}<span class="ml-1 text-2xl font-normal text-base-content/50"
						>{numeral.unit}</span
					>
				</p>
			{:else}
				<p class="text-display text-5xl leading-none font-semibold text-base-content">
					{label}
				</p>
			{/if}
			<p class="mt-2 text-xs tracking-[0.2em] text-base-content/60 uppercase">
				{label}
			</p>
		</div>
	</div>
</div>
