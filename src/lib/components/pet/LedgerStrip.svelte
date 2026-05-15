<!--
  LedgerStrip — small "Recent activity" feed shown under MoodHungerBars.

  Privacy: no user attribution by design (W3 — pet-system.md L943).
  Only source label, ± coin delta, relative time.

  States:
    - entries === null      → spinner-less skeleton (aria-busy)
    - entries.length === 0  → empty-state copy
    - entries.length > 0    → list

  Re-fetches on `refreshKey` change so the parent can pulse the strip
  whenever a mutation lands (own action OR partner broadcast).

  eslint-disable svelte/no-navigation-without-resolve — fullViewHref is
  always passed pre-resolved by the caller (Pathname returned from
  resolve()); no static literal href used inside.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import type { PetLedgerEntry } from '$lib/pet.constants';
	import { ledgerSourceLabel, relativeTime } from './ledger-i18n';

	type Props = {
		entries: PetLedgerEntry[] | null;
		/** Optional href to a fuller view (e.g. diagnostics page). */
		fullViewHref?: string;
	};

	let { entries, fullViewHref }: Props = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- fullViewHref is pre-resolved by caller -->

<section
	class="rounded-2xl border border-base-200 bg-base-100/60 p-4"
	aria-busy={entries === null}
	aria-label={m.pet_ledger_title()}
>
	<header class="mb-2 flex items-center justify-between">
		<h2 class="text-xs font-semibold tracking-wider text-base-content/60 uppercase">
			{m.pet_ledger_title()}
		</h2>
		{#if entries && entries.length > 0 && fullViewHref}
			<a
				href={fullViewHref}
				class="text-xs text-base-content/60 hover:text-primary focus-visible:text-primary"
			>
				→
			</a>
		{/if}
	</header>

	{#if entries === null}
		<ul class="space-y-2">
			{#each [0, 1, 2] as i (i)}
				<li class="flex items-center justify-between text-sm">
					<span class="block h-3 w-32 animate-pulse rounded bg-base-200"></span>
					<span class="block h-3 w-16 animate-pulse rounded bg-base-200"></span>
				</li>
			{/each}
		</ul>
	{:else if entries.length === 0}
		<p class="text-sm text-base-content/60">{m.pet_ledger_empty()}</p>
	{:else}
		<ul class="space-y-1.5">
			{#each entries as entry (entry.id)}
				{@const positive = entry.coinsDelta > 0}
				{@const negative = entry.coinsDelta < 0}
				<li class="flex items-baseline justify-between gap-3 text-sm">
					<span class="truncate text-base-content/80">
						{ledgerSourceLabel(entry.source)}
					</span>
					<span class="flex shrink-0 items-baseline gap-2 text-xs">
						{#if entry.coinsDelta !== 0}
							<span
								class="font-mono tabular-nums"
								class:text-success={positive}
								class:text-base-content={negative}
							>
								{positive ? '+' : ''}{entry.coinsDelta}
							</span>
						{/if}
						<time
							class="text-base-content/50"
							datetime={entry.createdAt}
							title={new Date(entry.createdAt).toLocaleString()}
						>
							{relativeTime(entry.createdAt)}
						</time>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>
