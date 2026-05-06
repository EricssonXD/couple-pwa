<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import { initInstallPrompt } from '$lib/pwa/install';
	import { registerServiceWorker } from '$lib/pwa/register';
	import UpdateBanner from '$lib/pwa/UpdateBanner.svelte';
	import './layout.css';

	let { children } = $props();

	onMount(() => {
		initInstallPrompt();
		registerServiceWorker();
	});
</script>

{@render children()}
<UpdateBanner />

<div style="display:none">
	{#each locales as locale}
		<a href={localizeHref(page.url.pathname, { locale })}>{locale}</a>
	{/each}
</div>
