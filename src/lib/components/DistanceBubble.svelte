<script lang="ts">
	import type { DistanceBucket } from '$lib/server/services/location';

	let { distanceM, bucket }: { distanceM: number | null; bucket: DistanceBucket } = $props();

	const labels: Record<DistanceBucket, { primary: string; sub: string }> = {
		together: { primary: '同處', sub: 'Together' },
		near: { primary: '近', sub: 'Nearby' },
		same_city: { primary: '同城', sub: 'Same city' },
		far: { primary: '遠', sub: 'Apart' },
		unknown: { primary: '?', sub: 'Waiting for fix' }
	};

	const display = $derived(labels[bucket]);
	const distanceLabel = $derived.by(() => {
		if (distanceM == null) return null;
		if (distanceM < 1000) return `${Math.round(distanceM)} m`;
		if (distanceM < 10_000) return `${(distanceM / 1000).toFixed(1)} km`;
		return `${Math.round(distanceM / 1000)} km`;
	});
</script>

<div
	class="card bg-gradient-to-br from-rose-500 to-violet-500 text-white shadow-xl"
	aria-live="polite"
>
	<div class="card-body items-center text-center">
		<p class="text-sm tracking-wider uppercase opacity-80">{display.sub}</p>
		<p class="text-5xl font-bold">{display.primary}</p>
		{#if distanceLabel}
			<p class="mt-2 text-lg opacity-90">{distanceLabel}</p>
		{/if}
	</div>
</div>
