<script lang="ts">
	import { onMount } from 'svelte';
	import { onSwUpdate, applySwUpdate, type SwUpdateState } from './register';

	let state = $state<SwUpdateState>('idle');

	onMount(() => onSwUpdate((s) => (state = s)));
</script>

{#if state === 'update-available'}
	<div class="update-banner" role="status" aria-live="polite">
		<span>A new version of DuoSync is ready.</span>
		<button onclick={applySwUpdate}>Reload</button>
	</div>
{/if}

<style>
	.update-banner {
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		bottom: max(1rem, env(safe-area-inset-bottom));
		z-index: 9999;
		display: flex;
		gap: 0.75rem;
		align-items: center;
		padding: 0.6rem 1rem;
		background: #111827;
		color: white;
		border-radius: 999px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
		font-size: 0.9rem;
	}
	button {
		background: linear-gradient(90deg, #e11d48, #6d28d9);
		border: none;
		color: white;
		padding: 0.35rem 0.85rem;
		border-radius: 999px;
		font-weight: 600;
		cursor: pointer;
	}
</style>
