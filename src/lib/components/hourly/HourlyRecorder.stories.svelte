<!--
	HourlyRecorder Storybook — F11 H3.

	Drives the real component but stubs network so it never hits a
	live API in the gallery.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import HourlyRecorder from './HourlyRecorder.svelte';

	const { Story } = defineMeta({
		title: 'F11/HourlyRecorder',
		component: HourlyRecorder,
		tags: ['autodocs']
	});
</script>

<script lang="ts">
	function stubNetwork(): void {
		if (typeof window === 'undefined') return;
		const origFetch = window.fetch.bind(window);
		window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.includes('/api/hourly/upload-attempt')) {
				return new Response(
					JSON.stringify({
						attemptId: 'storybook-attempt',
						uploadUrl: 'https://example.invalid/upload',
						storageKey: 'storybook/key',
						expiresAt: new Date(Date.now() + 60_000).toISOString(),
						hourBucket: new Date().toISOString()
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			if (url.startsWith('https://example.invalid/upload')) {
				return new Response('', { status: 200 });
			}
			if (url.includes('/api/hourly/finalize')) {
				return new Response(JSON.stringify({ id: 'clip-1' }), { status: 200 });
			}
			return origFetch(input, init);
		};
	}

	stubNetwork();
</script>

<Story name="Default">
	<div class="p-6">
		<HourlyRecorder />
	</div>
</Story>

<Story name="RearCamera">
	<div class="p-6">
		<HourlyRecorder facingMode="environment" />
	</div>
</Story>
