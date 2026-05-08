<script lang="ts">
	import { onMount } from 'svelte';
	import { canInstall, promptInstall, isStandalone } from '$lib/pwa/install';
	import { iosInstallMode, type IosInstallMode } from '$lib/pwa/ios-install';
	import { IosInstallSheet } from '$lib/components/duosync';

	let installable = $state(false);
	let standalone = $state(false);
	let iosMode = $state<IosInstallMode>(null);
	let iosSheetOpen = $state(false);

	onMount(() => {
		standalone = isStandalone();
		iosMode = iosInstallMode();
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
	<h1 class="text-display">DuoSync</h1>
	<p class="tag">A private, real-time digital sanctuary for two.</p>

	<ul class="features">
		<li>🫧 The Shared Pulse — distance, mood, battery at a glance.</li>
		<li>💬 Whisper Chat — lightweight, with read receipts.</li>
		<li>📍 Geo-Moments — leave notes that unlock when they're near.</li>
		<li>🔔 Proximity Alerts — quietly notified when they arrive.</li>
	</ul>

	{#if installable}
		<button class="cta" onclick={install}>Install DuoSync</button>
	{:else if iosMode}
		<button class="cta" onclick={() => (iosSheetOpen = true)}>
			{iosMode === 'safari' ? 'Add to Home Screen' : 'How to install on iPhone'}
		</button>
	{:else if standalone}
		<p class="installed">✓ Installed — welcome back.</p>
	{/if}

	<a class="cta secondary" href="/auth/sign-in">Get started</a>

	<p class="muted">Sign in with email to pair up.</p>
</main>

{#if iosMode}
	<IosInstallSheet bind:open={iosSheetOpen} mode={iosMode} />
{/if}

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
		background: var(--color-base-100);
		color: var(--color-base-content);
	}
	.logo img {
		filter: drop-shadow(0 8px 24px color-mix(in oklab, var(--color-primary) 25%, transparent));
	}
	h1 {
		font-size: clamp(2.75rem, 9vw, 4.25rem);
		margin: 0;
		color: var(--color-base-content);
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.tag {
		margin: 0;
		max-width: 28rem;
		color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
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
		background: var(--color-base-200);
		box-shadow: var(--shadow-paper);
		padding: 0.75rem 1rem;
		border-radius: var(--radius-card);
		color: var(--color-base-content);
	}
	.cta {
		margin-top: 0.5rem;
		padding: 0.85rem 1.75rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-primary-content);
		background: var(--color-primary);
		border: none;
		border-radius: var(--radius-bubble);
		cursor: pointer;
		box-shadow: var(--shadow-paper);
		transition: transform 120ms ease;
	}
	.cta:hover {
		transform: translateY(-1px);
	}
	.cta.secondary {
		text-decoration: none;
		display: inline-block;
		background: transparent;
		color: var(--color-primary);
		border: 1.5px solid color-mix(in oklab, var(--color-primary) 40%, transparent);
		box-shadow: none;
	}
	.installed,
	.muted {
		color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
		font-size: 0.9rem;
		margin: 0;
	}
	.muted {
		margin-top: 0.5rem;
		font-size: 0.8rem;
	}
</style>
