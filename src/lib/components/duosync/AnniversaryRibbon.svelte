<!--
  AnniversaryRibbon — slim header on /pulse showing days together
  and the next milestone countdown.

  Rebuilt from src/lib/components/AnniversaryRibbon.svelte to match
  the design tokens (no rainbow gradient — just a soft cream ribbon
  with rose accent). Date math is unchanged.
-->
<script lang="ts">
	type Props = {
		coupleSince: Date | string;
		anniversary: Date | string | null;
		nickname: string | null;
	};
	let { coupleSince, anniversary, nickname }: Props = $props();

	function dayDiffUTC(from: Date, to: Date): number {
		const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
		const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
		return Math.floor((b - a) / 86_400_000);
	}

	const baseDate = $derived(
		anniversary ? new Date(anniversary as string) : new Date(coupleSince as string)
	);
	const todayUTC = new Date();
	const daysTogether = $derived(Math.max(0, dayDiffUTC(baseDate, todayUTC)));

	type Milestone = { label: string; date: Date };
	const milestones = $derived.by((): Milestone[] => {
		const out: Milestone[] = [];
		for (const d of [100, 200, 365, 500, 1000, 2000, 3650]) {
			const t = new Date(baseDate);
			t.setUTCDate(t.getUTCDate() + d);
			out.push({ label: `${d} 天`, date: t });
		}
		for (let y = 1; y <= 15; y++) {
			const t = new Date(baseDate);
			t.setUTCFullYear(t.getUTCFullYear() + y);
			out.push({ label: `${y} 年`, date: t });
		}
		return out.sort((a, b) => a.date.getTime() - b.date.getTime());
	});

	const next = $derived(milestones.find((m) => m.date > todayUTC) ?? null);
	const daysToNext = $derived(next ? dayDiffUTC(todayUTC, next.date) : null);
	const isMilestoneToday = $derived(milestones.some((m) => dayDiffUTC(m.date, todayUTC) === 0));
</script>

<div
	class="bg-base-200/60 border-base-content/5 flex items-center justify-between gap-3 rounded-full border px-4 py-2 backdrop-blur"
>
	<div class="min-w-0">
		{#if isMilestoneToday}
			<p class="text-primary text-[10px] font-semibold tracking-[0.2em] uppercase">
				🎉 milestone
			</p>
		{:else if nickname}
			<p class="text-base-content/50 truncate text-[10px] tracking-[0.2em] uppercase">
				{nickname}
			</p>
		{:else}
			<p class="text-base-content/50 text-[10px] tracking-[0.2em] uppercase">together</p>
		{/if}
		<p class="text-display text-base-content text-lg leading-none font-semibold">
			{daysTogether.toLocaleString()}
			<span class="text-base-content/50 text-xs font-normal">天</span>
		</p>
	</div>
	{#if next && daysToNext != null}
		<div class="text-right">
			<p class="text-base-content/50 text-[10px] tracking-[0.2em] uppercase">next</p>
			<p class="text-base-content text-xs">
				<span class="text-display text-base font-semibold">{daysToNext}</span>
				天到 {next.label}
			</p>
		</div>
	{/if}
</div>
