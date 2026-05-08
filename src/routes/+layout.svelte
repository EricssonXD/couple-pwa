<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { beforeNavigate, goto } from '$app/navigation';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import { initInstallPrompt } from '$lib/pwa/install';
	import { registerServiceWorker } from '$lib/pwa/register';
	import UpdateBanner from '$lib/pwa/UpdateBanner.svelte';
	import { BottomNav } from '$lib/components/duosync';
	import { setRouteTheme, initTheme, type DuoSyncTheme } from '$lib/theme/index.svelte';
	import { hasAuthHint } from '$lib/client/auth-hint';
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

	// Offline guard: the SW intentionally never caches /auth/* (private
	// surface). When the device is offline AND we still have an auth
	// hint cookie (i.e. the user is signed in from this device's
	// perspective), any navigation that targets /auth/* would land on
	// a network-error page and strand the user away from the cached
	// app shell. Cancel the nav and reroute to /pulse instead — every
	// app surface that pushes to /auth/sign-in is doing so because of
	// a server-side session check that physically can't run offline.
	beforeNavigate(({ to, cancel }) => {
		if (!to) return;
		const path = to.url.pathname;
		if (!path.startsWith('/auth/')) return;
		if (typeof navigator !== 'undefined' && navigator.onLine) return;
		if (!hasAuthHint()) return;
		cancel();
		goto('/pulse', { replaceState: true });
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
