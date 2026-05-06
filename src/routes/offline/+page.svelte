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
</svelte:head>

<main class="offline">
	<div class="card">
		<div class="emoji" aria-hidden="true">🌙</div>
		<h1>You're offline</h1>
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
		padding: max(1.5rem, env(safe-area-inset-top)) 1.5rem
			max(1.5rem, env(safe-area-inset-bottom));
		background: linear-gradient(160deg, #0f172a 0%, #1e1b4b 100%);
		color: #e5e7eb;
	}
	.card {
		max-width: 26rem;
		text-align: center;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 1.25rem;
		padding: 2rem 1.5rem;
		backdrop-filter: blur(12px);
	}
	.emoji {
		font-size: 3rem;
		margin-bottom: 0.5rem;
	}
	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
	}
	p {
		margin: 0.25rem 0;
		color: #cbd5e1;
		font-size: 0.95rem;
	}
	.status {
		margin-top: 1rem;
		font-size: 0.85rem;
		color: #fbbf24;
	}
	.status.online {
		color: #4ade80;
	}
	.cta {
		margin-top: 1.25rem;
		padding: 0.75rem 1.5rem;
		font-weight: 600;
		color: white;
		background: linear-gradient(90deg, #e11d48, #6d28d9);
		border: none;
		border-radius: 999px;
		cursor: pointer;
	}
</style>
