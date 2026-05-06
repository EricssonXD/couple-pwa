<script lang="ts">
	import { onMount } from 'svelte';
	import { canInstall, promptInstall, isStandalone, isIosSafari } from '$lib/pwa/install';

	let installable = $state(false);
	let standalone = $state(false);
	let iosHint = $state(false);

	onMount(() => {
		standalone = isStandalone();
		iosHint = isIosSafari() && !standalone;
		const tick = () => (installable = canInstall());
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	});

	async function install() {
		await promptInstall();
		installable = canInstall();
	}
</script>

<svelte:head>
	<title>DuoSync — a sanctuary for two</title>
</svelte:head>

<main class="hero">
	<div class="logo" aria-hidden="true">
		<img src="/icon.svg" alt="" width="120" height="120" />
	</div>
	<h1>DuoSync</h1>
	<p class="tag">A private, real-time digital sanctuary for two.</p>

	<ul class="features">
		<li>🫧 The Shared Pulse — distance, mood, battery at a glance.</li>
		<li>💬 Whisper Chat — lightweight, with read receipts.</li>
		<li>📍 Geo-Moments — leave notes that unlock when they're near.</li>
		<li>🔔 Proximity Alerts — quietly notified when they arrive.</li>
	</ul>

	{#if installable}
		<button class="cta" onclick={install}>Install DuoSync</button>
	{:else if iosHint}
		<p class="ios-hint">Tap <strong>Share → Add to Home Screen</strong> to install.</p>
	{:else if standalone}
		<p class="installed">✓ Installed — welcome back.</p>
	{/if}

	<p class="muted">
		Setup, sign-in, and pairing flows are coming online phase-by-phase. See <code>plan.md</code>.
	</p>
</main>

<style>
	.hero {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.25rem;
		padding: 2rem 1.5rem;
		text-align: center;
		background: linear-gradient(160deg, #fdf2f8 0%, #f3e8ff 100%);
	}
	.logo img {
		filter: drop-shadow(0 8px 24px rgba(225, 29, 72, 0.25));
	}
	h1 {
		font-size: clamp(2.5rem, 8vw, 4rem);
		margin: 0;
		background: linear-gradient(90deg, #e11d48, #6d28d9);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.tag {
		margin: 0;
		max-width: 28rem;
		color: #4b5563;
		font-size: 1.1rem;
	}
	.features {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0;
		display: grid;
		gap: 0.5rem;
		max-width: 28rem;
		text-align: left;
	}
	.features li {
		background: rgba(255, 255, 255, 0.7);
		backdrop-filter: blur(8px);
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		color: #374151;
	}
	.cta {
		margin-top: 0.5rem;
		padding: 0.85rem 1.75rem;
		font-size: 1rem;
		font-weight: 600;
		color: white;
		background: linear-gradient(90deg, #e11d48, #6d28d9);
		border: none;
		border-radius: 999px;
		cursor: pointer;
		box-shadow: 0 8px 24px rgba(109, 40, 217, 0.3);
	}
	.cta:hover {
		transform: translateY(-1px);
		transition: transform 120ms ease;
	}
	.ios-hint,
	.installed,
	.muted {
		color: #6b7280;
		font-size: 0.9rem;
		margin: 0;
	}
	.muted {
		margin-top: 0.5rem;
		font-size: 0.8rem;
	}
	code {
		background: rgba(0, 0, 0, 0.06);
		padding: 0.05rem 0.35rem;
		border-radius: 0.25rem;
	}
</style>
