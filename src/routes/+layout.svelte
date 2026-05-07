<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import { initInstallPrompt } from '$lib/pwa/install';
	import { registerServiceWorker } from '$lib/pwa/register';
	import UpdateBanner from '$lib/pwa/UpdateBanner.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import './layout.css';
	import '$lib/motion/animations.css';

	let { children, data } = $props();

	const showNav = $derived(
		!!data?.user &&
			!!data?.couple &&
			!page.url.pathname.startsWith('/auth') &&
			!page.url.pathname.startsWith('/onboarding')
	);

	onMount(() => {
		initInstallPrompt();
		registerServiceWorker();
	});
</script>

<div class:pb-20={showNav}>
	{@render children()}
</div>
{#if showNav}
	<BottomNav />
{/if}
<UpdateBanner />

<div style="display:none">
	{#each locales as locale}
		<a href={localizeHref(page.url.pathname, { locale })}>{locale}</a>
	{/each}
</div>
