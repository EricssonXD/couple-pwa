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
	import * as m from '$lib/paraglide/messages.js';

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
		<h1>{m.offline_queue_title()}</h1>
		<p class="lead">{m.offline_queue_lead()}</p>
	</header>

	<section class="status">
		<CloudArrowUpIcon size={20} weight="duotone" />
		<div>
			<div class="big">{size}</div>
			<div class="muted">{m.offline_queue_pending()}</div>
		</div>
		<button type="button" onclick={retry} disabled={flushing || size === 0}>
			<ArrowClockwiseIcon size={14} weight="bold" />
			{flushing ? m.offline_queue_retrying() : m.offline_queue_retry_now()}
		</button>
	</section>

	<section>
		<h2>{m.offline_queue_dead_letter_count({ count: dead.length })}</h2>
		{#if dead.length === 0}
			<p class="muted">{m.offline_queue_dead_empty()}</p>
		{:else}
			<ul class="dead">
				{#each dead as entry (entry.id)}
					<li>
						<div class="endpoint">{entry.endpoint}</div>
						<div class="meta muted">
							{entry.method} • {entry.attempts}
							{entry.attempts === 1 ? m.offline_queue_attempt() : m.offline_queue_attempts()} •
							{m.offline_queue_created()}
							{new Date(entry.createdAt).toLocaleString()}
						</div>
					</li>
				{/each}
			</ul>
			<button type="button" class="danger" onclick={purge}>
				<TrashIcon size={14} weight="bold" />
				{m.offline_queue_discard_all()}
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
