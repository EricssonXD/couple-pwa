<script lang="ts">
	import { onMount } from 'svelte';

	let online = $state(true);

	onMount(() => {
		const update = () => (online = navigator.onLine);
		update();
		addEventListener('online', update);
		addEventListener('offline', update);
		return () => {
			removeEventListener('online', update);
			removeEventListener('offline', update);
		};
	});

	function retry() {
		location.reload();
	}
</script>

<svelte:head>
	<title>Offline — DuoSync</title>
	<!-- Force dark theme: this page is the "absent" state. Inline so it
	     applies even when SW serves the HTML before client hydration. -->
	<script>
		document.documentElement.dataset.theme = 'duosync-dark';
	</script>
</svelte:head>

<main class="offline">
	<div class="card">
		<div class="emoji" aria-hidden="true">🌙</div>
		<h1 class="text-display">You're offline</h1>
		<p>
			DuoSync needs a connection to refresh this page. The last data you saw is still cached and
			will reload automatically when you're back online.
		</p>
		<p class="status" class:online>
			{online ? 'Connection restored — tap retry.' : 'Waiting for the network…'}
		</p>
		<button class="cta" onclick={retry}>Retry</button>
	</div>
</main>

<style>
	.offline {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: max(1.5rem, env(safe-area-inset-top)) 1.5rem max(1.5rem, env(safe-area-inset-bottom));
		background: var(--color-base-100);
		color: var(--color-base-content);
	}
	.card {
		max-width: 26rem;
		text-align: center;
		background: var(--color-base-200);
		border-radius: var(--radius-card);
		padding: 2rem 1.5rem;
		box-shadow: var(--shadow-paper);
	}
	.emoji {
		font-size: 3rem;
		margin-bottom: 0.5rem;
	}
	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.75rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	p {
		margin: 0.25rem 0;
		color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
		font-size: 0.95rem;
	}
	.status {
		margin-top: 1rem;
		font-size: 0.85rem;
		color: var(--color-warning);
	}
	.status.online {
		color: var(--color-secondary);
	}
	.cta {
		margin-top: 1.25rem;
		padding: 0.75rem 1.5rem;
		font-weight: 600;
		color: var(--color-primary-content);
		background: var(--color-primary);
		border: none;
		border-radius: var(--radius-bubble);
		cursor: pointer;
		box-shadow: var(--shadow-paper);
	}
</style>
