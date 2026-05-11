<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { readAuthHint } from '$lib/client/auth-hint';

	// `/` is a router stub. The server load in +page.server.ts always
	// 303s, so this <script> only runs offline (SW served the cached `/`
	// HTML). The inline pre-paint script in app.html already attempts a
	// `location.replace()` synchronously before the body parses — this
	// onMount is the belt-and-braces fallback for when that script is
	// disabled (CSP) or somehow didn't fire.
	//
	// We render NO welcome content here, so even a worst-case "neither
	// redirect fired" leaves the user on a blank page rather than a
	// misleading marketing page they can't escape from offline.
	onMount(() => {
		const hint = readAuthHint();
		const dest = hint === 'onboarding' ? '/onboarding' : hint === 'pulse' ? '/pulse' : '/welcome';
		goto(resolve(dest), { replaceState: true });
	});
</script>

<svelte:head>
	<title>DuoSync</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<noscript>
	<meta http-equiv="refresh" content="0; url=/welcome" />
	<p style="text-align:center;padding:2rem">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- noscript fallback uses absolute path; resolve() is a runtime helper that won't run without JS. -->
		<a href="/welcome">Continue to DuoSync</a>
	</p>
</noscript>
