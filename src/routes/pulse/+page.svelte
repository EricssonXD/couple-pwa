<script lang="ts">
	import { goto } from '$app/navigation';
	import { signOut } from '$lib/auth-client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	async function handleSignOut() {
		await signOut();
		await goto('/');
	}
</script>

<svelte:head>
	<title>Pulse — DuoSync</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-10">
	<header class="flex items-center justify-between">
		<div>
			<p class="text-xs tracking-wider text-base-content/60 uppercase">Pulse</p>
			<h1 class="text-3xl font-semibold tracking-tight">
				You & {data.partner?.displayName ?? data.partner?.name ?? 'them'}
			</h1>
		</div>
		<button class="btn btn-ghost btn-sm" type="button" onclick={handleSignOut}>Sign out</button>
	</header>

	<section class="card mt-8 bg-gradient-to-br from-rose-500 to-violet-500 text-white shadow-xl">
		<div class="card-body items-center text-center">
			<div class="flex items-center gap-4 text-5xl">
				<span>{data.me.avatarEmoji ?? '💗'}</span>
				<span class="opacity-50">·</span>
				<span>{data.partner?.avatarEmoji ?? '💗'}</span>
			</div>
			<p class="mt-4 text-sm opacity-80">Distance, mood, and presence land here next.</p>
		</div>
	</section>

	<section class="mt-8 prose">
		<h2 class="text-lg">Coming next</h2>
		<ul class="text-sm">
			<li>Live distance bubble + last-seen</li>
			<li>Heartbeat tap (haptic ping)</li>
			<li>Mood weather + anniversary ribbon</li>
			<li>Whisper chat + geo-moments</li>
		</ul>
	</section>
</main>
