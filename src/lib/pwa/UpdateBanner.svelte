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
		background: var(--color-base-100);
		color: var(--color-base-content);
		border-radius: var(--radius-bubble);
		box-shadow: var(--shadow-paper);
		font-size: 0.9rem;
	}
	button {
		background: var(--color-primary);
		color: var(--color-primary-content);
		border: none;
		padding: 0.35rem 0.85rem;
		border-radius: var(--radius-bubble);
		font-weight: 600;
		cursor: pointer;
	}
</style>
