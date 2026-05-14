// DuoSync — Shared milestone math.
//
// Pure helpers used by AnniversaryRibbon (small chip on /pulse) and the
// /timeline route. Date math is in UTC throughout — same calendar day for
// every couple regardless of timezone.

export type MilestoneKind = 'days' | 'years';

export type Milestone = {
	kind: MilestoneKind;
	n: number;
	date: Date;
};

export function dayDiffUTC(from: Date, to: Date): number {
	const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
	const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
	return Math.floor((b - a) / 86_400_000);
}

export function resolveBaseDate(
	anniversary: Date | string | null,
	coupleSince: Date | string
): Date {
	const raw = anniversary ?? coupleSince;
	return raw instanceof Date ? raw : new Date(raw);
}

// TODO: make these forever, like every 100 days and every year milestone instead of a fixed list. But for now, this is good enough and we can add more as needed.
export const DAY_MILESTONES = [10, 50, 100, 200, 500, 1000, 2000] as const;
export const YEAR_MILESTONES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 40, 50] as const;

/**
 * Build the full milestone list (past + future), sorted ascending.
 */
export function allMilestones(baseDate: Date): Milestone[] {
	const out: Milestone[] = [];
	for (const n of DAY_MILESTONES) {
		const t = new Date(baseDate);
		t.setUTCDate(t.getUTCDate() + n);
		out.push({ kind: 'days', n, date: t });
	}
	for (const n of YEAR_MILESTONES) {
		const t = new Date(baseDate);
		t.setUTCFullYear(t.getUTCFullYear() + n);
		out.push({ kind: 'years', n, date: t });
	}
	return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function nextMilestone(milestones: Milestone[], today: Date): Milestone | null {
	return milestones.find((ms) => dayDiffUTC(today, ms.date) > 0) ?? null;
}

export function pastMilestones(milestones: Milestone[], today: Date): Milestone[] {
	return milestones.filter((ms) => dayDiffUTC(today, ms.date) <= 0);
}

export function futureMilestones(milestones: Milestone[], today: Date): Milestone[] {
	return milestones.filter((ms) => dayDiffUTC(today, ms.date) > 0);
}

export function isMilestoneToday(milestones: Milestone[], today: Date): boolean {
	return milestones.some((ms) => dayDiffUTC(ms.date, today) === 0);
}

export function daysTogether(baseDate: Date, today: Date = new Date()): number {
	return Math.max(0, dayDiffUTC(baseDate, today));
}
