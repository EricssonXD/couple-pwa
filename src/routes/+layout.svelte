<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import { initInstallPrompt } from '$lib/pwa/install';
	import { registerServiceWorker } from '$lib/pwa/register';
	import UpdateBanner from '$lib/pwa/UpdateBanner.svelte';
	import { BottomNav } from '$lib/components/duosync';
	import { setRouteTheme, initTheme, type DuoSyncTheme } from '$lib/theme/index.svelte';
	import './layout.css';
	import '$lib/motion/animations.css';

	let { children, data } = $props();

	const showNav = $derived(
		!!data?.user &&
			!!data?.couple &&
			!page.url.pathname.startsWith('/auth') &&
			!page.url.pathname.startsWith('/onboarding')
	);

	// 路徑 → 強制主題. 其餘從 prefers-color-scheme.
	const ROUTE_THEME: Array<[RegExp, DuoSyncTheme]> = [
		[/^\/map(\/|$)/, 'duosync-dark'],
		[/^\/moments\/new(\/|$)/, 'duosync-dark']
	];
	const forcedTheme = $derived(ROUTE_THEME.find(([rx]) => rx.test(page.url.pathname))?.[1]);

	$effect(() => {
		setRouteTheme(forcedTheme ?? null);
	});

	onMount(() => {
		initInstallPrompt();
		registerServiceWorker();
		return initTheme();
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
