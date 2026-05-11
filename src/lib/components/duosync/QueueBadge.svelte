<!--
  Floating offline-queue badge.

  Subscribes to onQueueChange(); renders a small pill in the bottom-
  right when there are pending writes. Tapping it deep-links to the
  management page. Hidden when the queue is empty so the UI stays
  quiet on the happy path.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { onQueueChange, queueSize } from '$lib/client/offline-queue';
	import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUpIcon';

	let size = $state(0);

	onMount(() => {
		void queueSize().then((n) => (size = n));
		return onQueueChange((n) => (size = n));
	});
</script>

{#if size > 0}
	<a
		class="queue-pill"
		href={resolve('/settings/offline-queue')}
		aria-label="{size} pending write{size === 1 ? '' : 's'} — open offline queue"
	>
		<CloudArrowUpIcon size={16} weight="duotone" />
		<span>{size}</span>
	</a>
{/if}

<style>
	.queue-pill {
		position: fixed;
		bottom: calc(env(safe-area-inset-bottom, 0) + 88px);
		right: 12px;
		z-index: 40;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 999px;
		background: var(--ds-color-surface, #1f2937);
		color: var(--ds-color-text, #f9fafb);
		font:
			600 12px/1 system-ui,
			sans-serif;
		text-decoration: none;
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.18);
		border: 1px solid var(--ds-color-border, rgb(255 255 255 / 0.12));
	}
	.queue-pill:hover {
		filter: brightness(1.1);
	}
</style>
