<!--
  /settings/offline-queue — manage the IndexedDB write queue.

  Shows live queue size + lists dead-letter entries (writes that
  exhausted the 8-attempt backoff). User can retry-all or clear the
  dead-letter list.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import {
		queueSize,
		listDead,
		clearDead,
		flush,
		onQueueChange,
		type QueuedRequest
	} from '$lib/client/offline-queue';
	import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUpIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';

	let size = $state(0);
	let dead = $state<QueuedRequest[]>([]);
	let flushing = $state(false);

	async function refresh() {
		size = await queueSize();
		dead = await listDead();
	}

	async function retry() {
		flushing = true;
		try {
			await flush();
			await refresh();
		} finally {
			flushing = false;
		}
	}

	async function purge() {
		await clearDead();
		await refresh();
	}

	onMount(() => {
		void refresh();
		return onQueueChange(() => void refresh());
	});
</script>

<div class="page">
	<header>
		<h1>Offline queue</h1>
		<p class="lead">
			Writes saved while offline (location pings, new moments). Drained automatically when the
			connection comes back.
		</p>
	</header>

	<section class="status">
		<CloudArrowUpIcon size={20} weight="duotone" />
		<div>
			<div class="big">{size}</div>
			<div class="muted">pending</div>
		</div>
		<button type="button" onclick={retry} disabled={flushing || size === 0}>
			<ArrowClockwiseIcon size={14} weight="bold" />
			{flushing ? 'Retrying…' : 'Retry now'}
		</button>
	</section>

	<section>
		<h2>Dead-letter ({dead.length})</h2>
		{#if dead.length === 0}
			<p class="muted">Nothing here — all writes have either succeeded or are still retrying.</p>
		{:else}
			<ul class="dead">
				{#each dead as entry (entry.id)}
					<li>
						<div class="endpoint">{entry.endpoint}</div>
						<div class="meta muted">
							{entry.method} • {entry.attempts} attempt{entry.attempts === 1 ? '' : 's'} • created {new Date(
								entry.createdAt
							).toLocaleString()}
						</div>
					</li>
				{/each}
			</ul>
			<button type="button" class="danger" onclick={purge}>
				<TrashIcon size={14} weight="bold" />
				Discard all
			</button>
		{/if}
	</section>
</div>

<style>
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: 24px 16px 96px;
		display: grid;
		gap: 24px;
	}
	header h1 {
		margin: 0 0 4px;
		font-size: 20px;
	}
	.lead {
		color: var(--ds-color-muted, #6b7280);
		margin: 0;
		font-size: 14px;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		border-radius: 12px;
		background: var(--ds-color-surface, #f3f4f6);
	}
	.status .big {
		font-size: 28px;
		font-weight: 700;
		line-height: 1;
	}
	.status .muted {
		font-size: 12px;
	}
	.status button {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 999px;
		border: 1px solid var(--ds-color-border, rgba(0, 0, 0, 0.12));
		background: var(--ds-color-bg, white);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.status button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	h2 {
		font-size: 16px;
		margin: 0 0 12px;
	}
	.muted {
		color: var(--ds-color-muted, #6b7280);
	}
	.dead {
		list-style: none;
		padding: 0;
		margin: 0 0 16px;
		display: grid;
		gap: 8px;
	}
	.dead li {
		padding: 12px;
		border-radius: 10px;
		border: 1px solid var(--ds-color-border, rgba(0, 0, 0, 0.08));
	}
	.endpoint {
		font-family: ui-monospace, monospace;
		font-size: 13px;
		font-weight: 600;
	}
	.meta {
		font-size: 12px;
		margin-top: 2px;
	}
	button.danger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 999px;
		border: 1px solid var(--ds-color-danger, #dc2626);
		color: var(--ds-color-danger, #dc2626);
		background: transparent;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
</style>
