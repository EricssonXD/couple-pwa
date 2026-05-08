<!--
  MemoryResurface — "去年今日 · on this day" card.

  Rebuild of src/lib/components/MemoryResurface.svelte using the new
  design language: cream paper card, gold sparkle icon, Fraunces
  numeral for the number-of-days-ago. Copy is bilingual; falls back
  to localized day-counts when daysAgo < 60.

  Two memory kinds:
    moment      → quote the body + author tag, deep link to /moments
    first_ping  → "我們從這天開始" with the start date

  When `memory` is null, renders nothing (no empty placeholder).
-->
<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { SparkleIcon } from '$lib/components/ui/icons';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';

	type Memory =
		| {
				kind: 'moment';
				id: string;
				authorId: string;
				body: string;
				lat: number;
				lon: number;
				createdAt: Date | string;
				daysAgo: number;
		  }
		| { kind: 'first_ping'; capturedAt: Date | string; daysAgo: number };

	type Props = {
		memory: Memory | null;
		viewerId: string;
		partnerName: string;
	};
	let { memory, viewerId, partnerName }: Props = $props();

	function fmtAgo(days: number): string {
		if (days < 60) return m.memory_days_ago({ days });
		if (days < 365) return m.memory_months_ago({ months: Math.round(days / 30) });
		const years = days / 365;
		const n = years >= 1.95 ? Math.round(years) : Math.round(years * 10) / 10;
		return m.memory_years_ago({ years: n });
	}
	function fmtDate(d: Date | string): string {
		const dt = typeof d === 'string' ? new Date(d) : d;
		return dt.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

{#if memory}
	<aside
		class="relative overflow-hidden rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 shadow-paper"
	>
		<header class="flex items-center justify-between gap-3 px-4 pt-3">
			<span class="inline-flex items-center gap-1.5">
				<Icon icon={SparkleIcon} size={16} weight="duotone" class="text-accent" />
				<span class="text-[10px] tracking-[0.2em] text-base-content/60 uppercase">
					{m.memory_on_this_day()}
				</span>
			</span>
			<time class="text-xs text-base-content/50">{fmtAgo(memory.daysAgo)}</time>
		</header>

		<div class="px-4 pt-2 pb-4">
			{#if memory.kind === 'moment'}
				<p class="text-xs text-base-content/70">
					{memory.authorId === viewerId ? m.memory_you() : partnerName} · {fmtDate(
						memory.createdAt
					)}
				</p>
				<p class="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-base-content italic">
					「{memory.body}」
				</p>
				<a
					href={resolve('/moments')}
					class="mt-3 inline-block text-xs font-semibold tracking-wider text-primary uppercase hover:underline"
				>
					see moments →
				</a>
			{:else}
				<p class="text-sm leading-relaxed text-base-content">
					{m.memory_first_ping_caption({ date: fmtDate(memory.capturedAt) })}
				</p>
			{/if}
		</div>
	</aside>
{/if}
