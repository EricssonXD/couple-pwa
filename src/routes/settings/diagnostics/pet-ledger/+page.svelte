<!--
  /settings/diagnostics/pet-ledger — read-only audit + reconcile.

  Lists last 50 ledger entries per page (newest first), shows absolute
  timestamps, and surfaces a manual "Reconcile wallet" button that
  posts /api/pet/reconcile. Idempotent on the server — running with
  no drift returns adjusted=0 and writes nothing.

  Privacy: no partner attribution shown (W3 invariant).

  eslint-disable svelte/no-navigation-without-resolve — pagination
  hrefs are built by appending `?page=N` to a resolve()'d pathname;
  the rule only matches resolve() as the entire value.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import Notice from '$lib/components/ui/Notice.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeftIcon';
	import { ledgerSourceLabel } from '$lib/components/pet/ledger-i18n';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	type ReconcileNotice = { kind: 'ok' } | { kind: 'fixed'; n: number } | { kind: 'error' };

	let busy = $state(false);
	let notice = $state<ReconcileNotice | null>(null);

	async function reconcile() {
		if (busy) return;
		busy = true;
		notice = null;
		try {
			const res = await fetch(resolve('/api/pet/reconcile'), { method: 'POST' });
			if (!res.ok) throw new Error(String(res.status));
			const body = (await res.json()) as { adjusted: number };
			notice = body.adjusted === 0 ? { kind: 'ok' } : { kind: 'fixed', n: body.adjusted };
			if (body.adjusted !== 0) await invalidateAll();
		} catch {
			notice = { kind: 'error' };
		} finally {
			busy = false;
		}
	}

	function fmtAbs(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleString();
	}

	function fmtDelta(n: number): string {
		if (n === 0) return '0';
		return n > 0 ? `+${n}` : String(n);
	}

	function deltaTone(n: number): string {
		if (n > 0) return 'text-success';
		if (n < 0) return 'text-error';
		return 'text-base-content/60';
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- pagination hrefs are resolve() + query -->

<svelte:head>
	<title>{m.pet_diag_title()}</title>
</svelte:head>

<main class="mx-auto max-w-screen-md space-y-4 p-4 pb-24">
	<header class="space-y-2">
		<a
			href={resolve('/settings')}
			class="inline-flex items-center gap-1 text-xs text-base-content/60 hover:text-primary"
		>
			<Icon icon={CaretLeftIcon} size={12} weight="bold" />
			<span>{m.pet_diag_back()}</span>
		</a>
		<h1 class="text-xl font-semibold">{m.pet_diag_title()}</h1>
		<p class="text-sm text-base-content/70">{m.pet_diag_subtitle()}</p>
	</header>

	<Card class="space-y-3">
		<div class="flex flex-wrap items-center gap-3">
			<PillButton variant="primary" disabled={busy} onclick={reconcile}>
				{busy ? m.pet_diag_reconcile_running() : m.pet_diag_reconcile_button()}
			</PillButton>
			{#if notice}
				{#if notice.kind === 'ok'}
					<Notice tone="success">{m.pet_diag_reconcile_ok()}</Notice>
				{:else if notice.kind === 'fixed'}
					<Notice tone="info">{m.pet_diag_reconcile_fixed({ n: String(notice.n) })}</Notice>
				{:else}
					<Notice tone="warning">{m.pet_diag_reconcile_error()}</Notice>
				{/if}
			{/if}
		</div>
	</Card>

	<Card class="space-y-2">
		{#if data.entries.length === 0}
			<p class="py-6 text-center text-sm text-base-content/60">{m.pet_diag_empty()}</p>
		{:else}
			<div
				class="grid grid-cols-[1fr_2fr_auto] gap-2 px-1 text-xs font-semibold tracking-wider text-base-content/50 uppercase"
			>
				<span>{m.pet_diag_col_when()}</span>
				<span>{m.pet_diag_col_source()}</span>
				<span class="justify-self-end">{m.pet_diag_col_delta()}</span>
			</div>
			<ul class="divide-y divide-base-200">
				{#each data.entries as entry (entry.id)}
					<li class="grid grid-cols-[1fr_2fr_auto] items-center gap-2 py-2 text-sm">
						<span class="text-xs text-base-content/60 tabular-nums">{fmtAbs(entry.createdAt)}</span>
						<span class="truncate">{ledgerSourceLabel(entry.source)}</span>
						<span
							class="justify-self-end font-mono text-sm tabular-nums {deltaTone(entry.coinsDelta)}"
						>
							{fmtDelta(entry.coinsDelta)}
						</span>
					</li>
				{/each}
			</ul>

			<div class="mt-3 flex items-center justify-between text-xs text-base-content/60">
				{#if data.page > 1}
					<a
						href={`${resolve('/settings/diagnostics/pet-ledger')}?page=${data.page - 1}`}
						class="hover:text-primary"
					>
						← {m.pet_diag_prev()}
					</a>
				{:else}
					<span></span>
				{/if}
				<span>{m.pet_diag_page({ n: String(data.page) })}</span>
				{#if data.hasNext}
					<a
						href={`${resolve('/settings/diagnostics/pet-ledger')}?page=${data.page + 1}`}
						class="hover:text-primary"
					>
						{m.pet_diag_next()} →
					</a>
				{:else}
					<span></span>
				{/if}
			</div>
		{/if}
	</Card>
</main>
