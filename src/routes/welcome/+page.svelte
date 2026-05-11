<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { canInstall, promptInstall, isStandalone } from '$lib/pwa/install';
	import { iosInstallMode, type IosInstallMode } from '$lib/pwa/ios-install';
	import { IosInstallSheet } from '$lib/components/duosync';
	import * as m from '$lib/paraglide/messages.js';

	// `/welcome` is the marketing/install page for anonymous users only.
	// Two layers keep signed-in users off it:
	//   1. `/welcome/+page.server.ts` 303s any request that arrives with
	//      `locals.user` populated → no flash on online direct hits.
	//   2. `static/route-stub.js` (loaded synchronously from app.html
	//      <head>) runs before the body parses, reads the `ds_auth`
	//      cookie, and `location.replace()`s authed visitors away from
	//      both `/` AND `/welcome`. This catches the offline / cached-
	//      HTML path where the server load can't run, so a returning
	//      signed-in user opening the PWA offline never sees this page
	//      paint even for a frame.
	// As a result there is no auth-hint check inside this script — it
	// has already been enforced at a layer that runs before hydration.
	let installable = $state(false);
	let standalone = $state(false);
	let iosMode = $state<IosInstallMode>(null);
	let iosSheetOpen = $state(false);
	let online = $state(true);

	onMount(() => {
		standalone = isStandalone();
		iosMode = iosInstallMode();
		online = navigator.onLine;
		const tick = () => (installable = canInstall());
		tick();
		const id = setInterval(tick, 1000);
		const onOnline = () => (online = true);
		const onOffline = () => (online = false);
		addEventListener('online', onOnline);
		addEventListener('offline', onOffline);
		return () => {
			clearInterval(id);
			removeEventListener('online', onOnline);
			removeEventListener('offline', onOffline);
		};
	});

	async function install() {
		await promptInstall();
		installable = canInstall();
	}
</script>

<svelte:head>
	<title>{m.welcome_title_tag()}</title>
</svelte:head>

<main class="hero">
	<div class="logo" aria-hidden="true">
		<img src="/icon.svg" alt="" width="120" height="120" />
	</div>
	<h1 class="text-display">{m.welcome_title()}</h1>
	<p class="tag">{m.welcome_tag()}</p>

	<ul class="features">
		<li>{m.welcome_feature_pulse()}</li>
		<li>{m.welcome_feature_chat()}</li>
		<li>{m.welcome_feature_moments()}</li>
		<li>{m.welcome_feature_proximity()}</li>
	</ul>

	{#if installable}
		<button class="cta" onclick={install}>{m.welcome_install()}</button>
	{:else if iosMode}
		<button class="cta" onclick={() => (iosSheetOpen = true)}>
			{iosMode === 'safari' ? m.welcome_ios_install_safari() : m.welcome_ios_install_other()}
		</button>
	{:else if standalone}
		<p class="installed">{m.welcome_installed()}</p>
	{/if}

	{#if online}
		<a class="cta secondary" href={resolve('/auth/sign-in')}>{m.welcome_get_started()}</a>
		<p class="muted">{m.welcome_get_started_hint()}</p>
	{:else}
		<button class="cta secondary" disabled aria-disabled="true">{m.welcome_get_started()}</button>
		<p class="muted">{m.welcome_offline_hint()}</p>
	{/if}
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
