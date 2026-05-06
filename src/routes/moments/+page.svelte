<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { createRealtimeClient } from '$lib/client/realtime.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();
	const rt = createRealtimeClient({ coupleId: data.coupleId, userId: data.me.id });

	let busyDelete = $state<string | null>(null);

	onMount(() => {
		void rt.start();
	});
	onDestroy(() => {
		void rt.stop();
	});

	$effect(() => {
		const last = rt.lastMomentEvent;
		if (!last) return;
		void invalidateAll();
	});

	async function remove(id: string) {
		busyDelete = id;
		try {
			await fetch(`/api/moments/${id}`, { method: 'DELETE' });
			await invalidateAll();
		} finally {
			busyDelete = null;
		}
	}

	function fmt(iso: string) {
		const d = new Date(iso);
		return d.toLocaleString();
	}
</script>

<svelte:head>
	<title>Moments · DuoSync</title>
</svelte:head>

<div class="mx-auto max-w-md space-y-4 p-4">
	<header class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">Moments</h1>
		<a class="btn btn-sm btn-primary" href="/moments/new">+ Drop</a>
	</header>

	{#if data.moments.length === 0}
		<p class="text-sm text-base-content/60">
			No moments yet. Tap <em>+ Drop</em> at a place to leave a note for your partner.
		</p>
	{:else}
		<ul class="space-y-3">
			{#each data.moments as m (m.id)}
				{@const locked = !m.isMine && m.unlockedAt == null}
				<li class="card bg-base-200 shadow-sm">
					<div class="card-body p-4">
						<div class="flex items-start justify-between gap-2">
							<div class="text-xs tracking-wide uppercase opacity-70">
								{#if m.isMine}
									You · {fmt(m.createdAt)}
								{:else if locked}
									Partner · locked
								{:else}
									Partner · unlocked {m.unlockedAt ? fmt(m.unlockedAt) : ''}
								{/if}
							</div>
							{#if m.isMine}
								<button
									class="btn btn-ghost btn-xs"
									disabled={busyDelete === m.id}
									onclick={() => remove(m.id)}
								>
									Delete
								</button>
							{/if}
						</div>

						{#if locked}
							<p class="italic opacity-60">
								🔒 Walk closer to read — within ~{m.radiusM}m of the pin.
							</p>
						{:else if m.body}
							<p class="whitespace-pre-wrap">{m.body}</p>
						{:else}
							<p class="italic opacity-60">(no content)</p>
						{/if}

						<div class="text-xs opacity-60">
							{m.lat.toFixed(5)}, {m.lon.toFixed(5)} · r={m.radiusM}m
							{#if m.expiresAt}· expires {fmt(m.expiresAt)}{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
