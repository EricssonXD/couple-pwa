<!--
  MoodTrendStrip — last-N-day mood emoji strip.

  Renders one cell per UTC day in the supplied bucket array. Days with
  no recorded mood show a muted dot. The strip is purely a read-side
  visualization of the user's own mood history; per RLS on mood_pulse,
  only the owner can ever see this data (mood is loaded SSR via the
  service-role Drizzle client, which is fine — only the user themselves
  sees their own settings page).

  Props:
    buckets   — TrendBucket[]: { date: 'YYYY-MM-DD', mood: Mood | null }[]
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { Mood, TrendBucket } from '$lib/server/services/mood';
	import MoodFace from '$lib/components/ui/MoodFace.svelte';

	let { buckets }: { buckets: TrendBucket[] } = $props();

	const LABEL: Record<Mood, () => string> = {
		joyful: m.mood_pick_joyful,
		happy: m.mood_pick_happy,
		neutral: m.mood_pick_neutral,
		sad: m.mood_pick_sad,
		upset: m.mood_pick_upset
	};

	const hasAny = $derived(buckets.some((b) => b.mood !== null));
</script>

<div class="space-y-2">
	<h3 class="text-xs text-base-content/60">{m.mood_trend_heading()}</h3>
	{#if !hasAny}
		<p class="text-xs text-base-content/50">{m.mood_trend_no_data()}</p>
	{:else}
		<ol class="flex flex-wrap gap-1.5" aria-label={m.mood_trend_heading()}>
			{#each buckets as b (b.date)}
				{@const label = b.mood
					? `${b.date}: ${LABEL[b.mood]()}`
					: `${b.date}: ${m.mood_trend_no_data()}`}
				<li
					class="flex h-7 w-7 items-center justify-center rounded-md border border-base-content/10 bg-base-100"
					class:opacity-30={!b.mood}
					title={label}
					aria-label={label}
				>
					{#if b.mood}
						<MoodFace mood={b.mood} size={20} />
					{:else}
						<span aria-hidden="true" class="text-xs text-base-content/40">·</span>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>
