<!--
  /onboarding/link — pair via 6-char code or QR (U6e).

  Same server contract: GET load returns {code, expiresAt, shareUrl,
  prefillCode}; POST /api/couple/redeem still pairs. Visual rebuild
  only. On success we play a paired-bloom celebration overlay
  (animate-bloom on a heart) before goto('/pulse').
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import QRCode from 'qrcode';
	import Icon from '$lib/components/ui/Icon.svelte';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import ShareNetworkIcon from 'phosphor-svelte/lib/ShareNetworkIcon';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let qrDataUrl = $state<string | null>(null);
	let typedCode = $state(data.prefillCode ?? '');
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
		// 等動畫 (1.2s bloom + 600ms 留白) 後再跳.
		await new Promise((r) => setTimeout(r, 1500));
		await goto('/pulse', { invalidateAll: true });
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
				error = body?.message ?? 'Could not pair';
				return;
			}
			await celebrateAndGo();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>配對 · DuoSync</title>
</svelte:head>

<main class="bg-base-100 relative min-h-screen px-5 py-10">
	<div class="mx-auto max-w-md">
		<div class="text-center">
			<h1 class="text-display text-3xl font-semibold tracking-wide">配對</h1>
			<p class="text-base-content/60 mt-2 text-sm">把碼分享給對方, 或輸入對方的碼.</p>
		</div>

		<section
			class="bg-base-200 shadow-paper border-base-content/5 mt-6 rounded-[var(--radius-card)] border"
		>
			<div class="p-6 text-center">
				<p class="text-base-content/50 text-[10px] tracking-[0.3em] uppercase">your code</p>
				<p class="text-display mt-2 text-4xl font-semibold tracking-[0.4em]">{data.code}</p>
				<p class="text-base-content/40 mt-1 text-xs">{remaining} 分鐘後過期</p>

				{#if qrDataUrl}
					<img
						src={qrDataUrl}
						alt="QR code linking to {data.shareUrl}"
						width="240"
						height="240"
						class="mx-auto mt-5 rounded-[var(--radius-card)]"
					/>
				{:else}
					<div class="bg-base-300 mx-auto mt-5 h-60 w-60 animate-pulse rounded-[var(--radius-card)]"></div>
				{/if}

				<div class="mt-5 flex gap-2">
					<button
						class="border-base-content/15 hover:bg-base-300 inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2.5 text-xs font-semibold tracking-wider uppercase"
						type="button"
						onclick={copyCode}
					>
						<Icon icon={CopyIcon} size={14} weight="duotone" />
						{copied ? 'copied!' : 'copy'}
					</button>
					<button
						class="bg-primary text-primary-content inline-flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold tracking-wider uppercase"
						type="button"
						onclick={shareLink}
					>
						<Icon icon={ShareNetworkIcon} size={14} weight="duotone" /> share
					</button>
				</div>
			</div>
		</section>

		<div
			class="text-base-content/40 my-8 flex items-center gap-3 text-[10px] tracking-[0.3em] uppercase"
		>
			<span class="bg-base-content/10 h-px flex-1"></span>
			<span>or enter a code</span>
			<span class="bg-base-content/10 h-px flex-1"></span>
		</div>

		<form class="space-y-3" onsubmit={redeem}>
			<input
				class="bg-base-200 border-base-content/10 focus:border-primary text-display w-full rounded-[var(--radius-card)] border px-4 py-3 text-center text-2xl tracking-[0.3em] uppercase outline-none"
				type="text"
				minlength="4"
				maxlength="10"
				bind:value={typedCode}
				placeholder="ABCXYZ"
				autocomplete="one-time-code"
				inputmode="text"
			/>
			<button
				class="bg-primary text-primary-content shadow-paper w-full rounded-full py-3.5 text-base font-semibold tracking-wider uppercase transition-transform active:scale-[0.98] disabled:opacity-50"
				type="submit"
				disabled={busy || !typedCode.trim()}
			>
				{busy ? '配對中…' : '配對 ❤'}
			</button>
			{#if error}
				<div class="bg-error/10 text-error rounded-[var(--radius-card)] px-4 py-3 text-sm">
					{error}
				</div>
			{/if}
		</form>
	</div>

	{#if celebrating}
		<!-- 配對成功之 bloom celebration 蓋層 -->
		<div
			class="bg-base-100/90 fixed inset-0 z-50 grid place-items-center backdrop-blur"
			role="status"
			aria-live="polite"
		>
			<div class="text-center">
				<div
					class="bg-primary/15 text-primary animate-bloom mx-auto grid h-32 w-32 place-items-center rounded-full"
				>
					<Icon icon={HeartIcon} size={64} weight="fill" />
				</div>
				<p class="text-display text-base-content mt-6 text-2xl font-semibold tracking-wide">
					心已連
				</p>
				<p class="text-base-content/60 mt-1 text-sm">paired</p>
			</div>
		</div>
	{/if}
</main>
