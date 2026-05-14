<!--
  /settings/activity — H5 audit log readout.

  Lists privacy-relevant actions the *current user* has taken on
  themselves (ghost on/off, unpair, account deletion request/cancel).
  Visible only to the acting user — the partner cannot see this page
  via any client query (RLS denies it). Anti-coercion: a user who is
  pressured to "prove" they've been transparent has receipts.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { BackButton } from '$lib/components/duosync';
	import GhostIcon from 'phosphor-svelte/lib/GhostIcon';
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
	import HeartBreakIcon from 'phosphor-svelte/lib/HeartBreakIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	function iconFor(action: string) {
		if (action === 'ghost.enable') return GhostIcon;
		if (action === 'ghost.disable') return EyeIcon;
		if (action === 'unpair.request') return HeartBreakIcon;
		if (action === 'account.delete.request') return TrashIcon;
		if (action === 'account.delete.cancel') return ArrowCounterClockwiseIcon;
		return EyeIcon;
	}

	function labelFor(action: string): string {
		switch (action) {
			case 'ghost.enable':
				return m.audit_ghost_enable();
			case 'ghost.disable':
				return m.audit_ghost_disable();
			case 'unpair.request':
				return m.audit_unpair();
			case 'account.delete.request':
				return m.audit_delete_request();
			case 'account.delete.cancel':
				return m.audit_delete_cancel();
			default:
				return action;
		}
	}

	function fmt(ts: string): string {
		const d = new Date(ts);
		return d.toLocaleString();
	}
</script>

<svelte:head>
	<title>{m.audit_title()} · DuoSync</title>
</svelte:head>

<main class="min-h-screen bg-base-100 px-5 py-8">
	<div class="mx-auto max-w-md">
		<div class="mb-2"><BackButton fallbackHref="/settings" /></div>
		<header class="mb-4">
			<h1 class="text-display text-2xl font-semibold tracking-wide">{m.audit_title()}</h1>
			<p class="mt-1 text-xs text-base-content/60">{m.audit_intro()}</p>
		</header>

		{#if data.entries.length === 0}
			<div
				class="rounded-[var(--radius-card)] border border-base-content/10 bg-base-200 p-8 text-center text-sm text-base-content/60"
			>
				{m.audit_empty()}
			</div>
		{:else}
			<ol class="space-y-2">
				{#each data.entries as e (e.id)}
					<li
						class="flex items-start gap-3 rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 p-3"
					>
						<Icon icon={iconFor(e.action)} size={18} weight="duotone" class="mt-0.5 text-primary" />
						<div class="flex-1">
							<p class="text-sm font-medium">{labelFor(e.action)}</p>
							<p class="text-xs text-base-content/60">{fmt(e.createdAt)}</p>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</main>
