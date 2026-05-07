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
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';

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
		if (days < 60) return `${days} 天前 · ${days}d ago`;
		if (days < 365) return `${Math.round(days / 30)} 個月前`;
		const years = days / 365;
		return years >= 1.95
			? `${Math.round(years)} 年前`
			: `${Math.round(years * 10) / 10} 年前`;
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
		class="bg-base-200 shadow-paper border-base-content/5 relative overflow-hidden rounded-[var(--radius-card)] border"
	>
		<header class="flex items-center justify-between gap-3 px-4 pt-3">
			<span class="inline-flex items-center gap-1.5">
				<Icon icon={SparkleIcon} size={16} weight="duotone" class="text-accent" />
				<span class="text-base-content/60 text-[10px] tracking-[0.2em] uppercase">
					on this day · 去年今日
				</span>
			</span>
			<time class="text-base-content/50 text-xs">{fmtAgo(memory.daysAgo)}</time>
		</header>

		<div class="px-4 pt-2 pb-4">
			{#if memory.kind === 'moment'}
				<p class="text-base-content/70 text-xs">
					{memory.authorId === viewerId ? 'You · 你' : partnerName} · {fmtDate(memory.createdAt)}
				</p>
				<p class="text-base-content mt-2 text-sm leading-relaxed whitespace-pre-wrap italic">
					「{memory.body}」
				</p>
				<a
					href="/moments"
					class="text-primary mt-3 inline-block text-xs font-semibold tracking-wider uppercase hover:underline"
				>
					see moments →
				</a>
			{:else}
				<p class="text-base-content text-sm leading-relaxed">
					從 <span class="text-display font-semibold">{fmtDate(memory.capturedAt)}</span>
					起，我們開始同步。Still here. 💞
				</p>
			{/if}
		</div>
	</aside>
{/if}
