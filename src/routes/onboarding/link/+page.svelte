<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import QRCode from 'qrcode';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let qrDataUrl = $state<string | null>(null);
	let typedCode = $state(data.prefillCode ?? '');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let copied = $state(false);

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
			await goto('/pulse', { invalidateAll: true });
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Pair with your partner — DuoSync</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-10">
	<h1 class="text-3xl font-semibold tracking-tight">Pair up</h1>
	<p class="mt-2 text-sm text-base-content/70">
		Share your code, or enter the one your partner sent you.
	</p>

	<section class="card mt-6 bg-base-100 shadow">
		<div class="card-body items-center text-center">
			<p class="text-xs tracking-wider text-base-content/60 uppercase">Your code</p>
			<p class="font-mono text-4xl font-semibold tracking-[0.4em]">{data.code}</p>
			<p class="text-xs text-base-content/50">Expires in {remaining} min</p>

			{#if qrDataUrl}
				<img
					src={qrDataUrl}
					alt="QR code linking to {data.shareUrl}"
					width="240"
					height="240"
					class="mt-2 rounded-lg"
				/>
			{:else}
				<div class="mt-2 h-60 w-60 skeleton"></div>
			{/if}

			<div class="mt-4 flex w-full gap-2">
				<button class="btn flex-1 btn-outline" type="button" onclick={copyCode}>
					{copied ? 'Copied!' : 'Copy code'}
				</button>
				<button class="btn flex-1 btn-primary" type="button" onclick={shareLink}>Share</button>
			</div>
		</div>
	</section>

	<div class="divider mt-8 text-xs text-base-content/50">or enter a code</div>

	<form class="space-y-3" onsubmit={redeem}>
		<input
			class="input-bordered input w-full text-center font-mono text-2xl tracking-[0.3em] uppercase"
			type="text"
			minlength="4"
			maxlength="10"
			bind:value={typedCode}
			placeholder="ABCXYZ"
			autocomplete="one-time-code"
			inputmode="text"
		/>
		<button class="btn w-full btn-primary" type="submit" disabled={busy || !typedCode.trim()}>
			{busy ? 'Pairing…' : 'Pair now'}
		</button>
		{#if error}
			<div class="alert text-sm alert-error">{error}</div>
		{/if}
	</form>
</main>
