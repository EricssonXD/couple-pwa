<script lang="ts">
	interface Props {
		coupleSince: Date | string;
		anniversary: Date | string | null;
		nickname: string | null;
	}
	const { coupleSince, anniversary, nickname }: Props = $props();

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

	// Build a milestone list and find the next one.
	type Milestone = { label: string; date: Date };
	const milestones = $derived.by((): Milestone[] => {
		const out: Milestone[] = [];
		const dayMarks = [100, 200, 365, 500, 1000, 2000, 3650];
		for (const d of dayMarks) {
			const t = new Date(baseDate);
			t.setUTCDate(t.getUTCDate() + d);
			out.push({ label: `${d} days`, date: t });
		}
		// Year anniversaries 1..15
		for (let y = 1; y <= 15; y++) {
			const t = new Date(baseDate);
			t.setUTCFullYear(t.getUTCFullYear() + y);
			out.push({ label: `${y} year${y > 1 ? 's' : ''}`, date: t });
		}
		return out.sort((a, b) => a.date.getTime() - b.date.getTime());
	});

	const next = $derived(milestones.find((m) => m.date > todayUTC) ?? null);
	const daysToNext = $derived(next ? dayDiffUTC(todayUTC, next.date) : null);

	const isMilestoneToday = $derived(milestones.some((m) => dayDiffUTC(m.date, todayUTC) === 0));
</script>

<div
	class="rounded-2xl bg-gradient-to-r from-primary/10 via-secondary/10 to-accent/10 p-3 text-center"
>
	{#if isMilestoneToday}
		<p class="text-xs font-semibold tracking-wider text-primary uppercase">🎉 Milestone today</p>
	{:else if nickname}
		<p class="text-xs tracking-wider text-base-content/60 uppercase">{nickname}</p>
	{:else}
		<p class="text-xs tracking-wider text-base-content/60 uppercase">Together</p>
	{/if}
	<p class="mt-0.5 text-2xl font-semibold tracking-tight">
		{daysTogether.toLocaleString()} <span class="text-sm text-base-content/60">days</span>
	</p>
	{#if next && daysToNext != null}
		<p class="mt-0.5 text-xs text-base-content/60">
			{daysToNext === 0 ? 'today' : `${daysToNext} day${daysToNext === 1 ? '' : 's'}`}
			until {next.label}
		</p>
	{/if}
</div>
