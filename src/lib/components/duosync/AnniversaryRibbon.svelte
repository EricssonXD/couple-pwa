<!--
  AnniversaryRibbon — slim header on /pulse showing days together
  and the next milestone countdown.

  Rebuilt from src/lib/components/AnniversaryRibbon.svelte to match
  the design tokens (no rainbow gradient — just a soft cream ribbon
  with rose accent). Date math is unchanged.
-->
<script lang="ts">
	import * as tr from '$lib/paraglide/messages.js';

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
			out.push({ label: tr.anniversary_milestone_days({ n: d }), date: t });
		}
		for (let y = 1; y <= 15; y++) {
			const t = new Date(baseDate);
			t.setUTCFullYear(t.getUTCFullYear() + y);
			out.push({ label: tr.anniversary_milestone_years({ n: y }), date: t });
		}
		return out.sort((a, b) => a.date.getTime() - b.date.getTime());
	});

	const next = $derived(milestones.find((ms) => ms.date > todayUTC) ?? null);
	const daysToNext = $derived(next ? dayDiffUTC(todayUTC, next.date) : null);
	const isMilestoneToday = $derived(milestones.some((ms) => dayDiffUTC(ms.date, todayUTC) === 0));
</script>

<div
	class="flex items-center justify-between gap-3 rounded-full border border-base-content/5 bg-base-200/60 px-4 py-2 backdrop-blur"
>
	<div class="min-w-0">
		{#if isMilestoneToday}
			<p class="text-[10px] font-semibold tracking-[0.2em] text-primary uppercase">🎉 milestone</p>
		{:else if nickname}
			<p class="truncate text-[10px] tracking-[0.2em] text-base-content/50 uppercase">
				{nickname}
			</p>
		{:else}
			<p class="text-[10px] tracking-[0.2em] text-base-content/50 uppercase">together</p>
		{/if}
		<p class="text-display text-lg leading-none font-semibold text-base-content">
			{daysTogether.toLocaleString()}
			<span class="text-xs font-normal text-base-content/50">{tr.anniversary_days_unit()}</span>
		</p>
	</div>
	{#if next && daysToNext != null}
		<div class="text-right">
			<p class="text-[10px] tracking-[0.2em] text-base-content/50 uppercase">next</p>
			<p class="text-xs text-base-content">
				<span class="text-display text-base font-semibold">{daysToNext}</span>
				{tr.anniversary_to_label({ label: next.label })}
			</p>
		</div>
	{/if}
</div>
