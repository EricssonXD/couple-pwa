<!--
  /onboarding/link — pair via 6-char code or QR (U6e).

  Same server contract: GET load returns {code, expiresAt, shareUrl,
  prefillCode}; POST /api/couple/redeem still pairs. Visual rebuild
  only. On success we play a paired-bloom celebration overlay
  (animate-bloom on a heart) before goto('/pulse').
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import QRCode from 'qrcode';
	import * as m from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/ui/Icon.svelte';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import ShareNetworkIcon from 'phosphor-svelte/lib/ShareNetworkIcon';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let qrDataUrl = $state<string | null>(null);
	let typedCode = $state(untrack(() => data.prefillCode ?? ''));
	let busy = $state(false);
	let error = $state<string | null>(null);
	let copied = $state(false);
	let celebrating = $state(false);

	const remaining = $derived.by(() => {
		const ms = new Date(data.expiresAt).getTime() - Date.now();
		return Math.max(0, Math.floor(ms / 60_000));
	});

	onMount(async () => {
		qrDataUrl = await QRCode.toDataURL(data.shareUrl, { width: 240, margin: 1 });
	});

	async function copyCode() {
		await navigator.clipboard.writeText(data.code);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	async function shareLink() {
		if (!('share' in navigator)) return copyCode();
		try {
			await navigator.share({
				title: 'Join me on DuoSync',
				text: `Pair with me using code ${data.code}`,
				url: data.shareUrl
			});
		} catch {
			/* user cancelled */
		}
	}

	async function celebrateAndGo() {
		celebrating = true;
		await new Promise((r) => setTimeout(r, 1500));
		await goto(resolve('/pulse'), { invalidateAll: true });
	}

	async function redeem(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		try {
			const res = await fetch('/api/couple/redeem', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: typedCode.trim().toUpperCase() })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body?.message ?? m.link_pair_failure();
				return;
			}
			await celebrateAndGo();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{m.onboarding_link_title()} · DuoSync</title>
</svelte:head>

<main class="relative min-h-screen bg-base-100 px-5 py-10">
	<div class="mx-auto max-w-md">
		<div class="text-center">
			<h1 class="text-display text-3xl font-semibold tracking-wide">{m.onboarding_link_title()}</h1>
			<p class="mt-2 text-sm text-base-content/60">{m.link_subtitle()}</p>
		</div>

		<section
			class="mt-6 rounded-[var(--radius-card)] border border-base-content/5 bg-base-200 shadow-paper"
		>
			<div class="p-6 text-center">
				<p class="text-[10px] tracking-[0.3em] text-base-content/50 uppercase">
					{m.link_your_code()}
				</p>
				<p class="text-display mt-2 text-4xl font-semibold tracking-[0.4em]">{data.code}</p>
				<p class="mt-1 text-xs text-base-content/40">{m.link_minutes_left({ n: remaining })}</p>

				{#if qrDataUrl}
					<img
						src={qrDataUrl}
						alt="QR code linking to {data.shareUrl}"
						width="240"
						height="240"
						class="mx-auto mt-5 rounded-[var(--radius-card)]"
					/>
				{:else}
					<div
						class="mx-auto mt-5 h-60 w-60 animate-pulse rounded-[var(--radius-card)] bg-base-300"
					></div>
				{/if}

				<div class="mt-5 flex gap-2">
					<button
						class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-base-content/15 py-2.5 text-xs font-semibold tracking-wider uppercase hover:bg-base-300"
						type="button"
						onclick={copyCode}
					>
						<Icon icon={CopyIcon} size={14} weight="duotone" />
						{copied ? m.link_copied() : m.link_copy()}
					</button>
					<button
						class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary py-2.5 text-xs font-semibold tracking-wider text-primary-content uppercase"
						type="button"
						onclick={shareLink}
					>
						<Icon icon={ShareNetworkIcon} size={14} weight="duotone" />
						{m.link_share()}
					</button>
				</div>
			</div>
		</section>

		<div
			class="my-8 flex items-center gap-3 text-[10px] tracking-[0.3em] text-base-content/40 uppercase"
		>
			<span class="h-px flex-1 bg-base-content/10"></span>
			<span>{m.link_or_enter()}</span>
			<span class="h-px flex-1 bg-base-content/10"></span>
		</div>

		<form class="space-y-3" onsubmit={redeem}>
			<input
				class="text-display w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-200 px-4 py-3 text-center text-2xl tracking-[0.3em] uppercase outline-none focus:border-primary"
				type="text"
				minlength="4"
				maxlength="10"
				bind:value={typedCode}
				placeholder="ABCXYZ"
				autocomplete="one-time-code"
				inputmode="text"
			/>
			<button
				class="w-full rounded-full bg-primary py-3.5 text-base font-semibold tracking-wider text-primary-content uppercase shadow-paper transition-transform active:scale-[0.98] disabled:opacity-50"
				type="submit"
				disabled={busy || !typedCode.trim()}
			>
				{busy ? m.onboarding_link_pairing() : m.link_pair_btn()}
			</button>
			{#if error}
				<div class="rounded-[var(--radius-card)] bg-error/10 px-4 py-3 text-sm text-error">
					{error}
				</div>
			{/if}
		</form>
	</div>

	{#if celebrating}
		<div
			class="fixed inset-0 z-50 grid place-items-center bg-base-100/90 backdrop-blur"
			role="status"
			aria-live="polite"
		>
			<div class="text-center">
				<div
					class="animate-bloom mx-auto grid h-32 w-32 place-items-center rounded-full bg-primary/15 text-primary"
				>
					<Icon icon={HeartIcon} size={64} weight="fill" />
				</div>
				<p class="text-display mt-6 text-2xl font-semibold tracking-wide text-base-content">
					{m.link_hearts_connected()}
				</p>
				<p class="mt-1 text-sm text-base-content/60">{m.link_paired_caption()}</p>
			</div>
		</div>
	{/if}
</main>
