<script lang="ts">
	import { invalidateAll, goto } from '$app/navigation';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let displayName = $state(data.me.displayName);
	let avatarEmoji = $state(data.me.avatarEmoji);
	let nickname = $state(data.couple?.nickname ?? '');
	let anniversary = $state<string>(
		typeof data.couple?.anniversary === 'string'
			? data.couple.anniversary
			: data.couple?.anniversary
				? new Date(data.couple.anniversary as unknown as string).toISOString().slice(0, 10)
				: ''
	);
	let ghost = $state(data.me.ghostMode);
	let busy = $state<string | null>(null);
	let msg = $state<string | null>(null);

	async function saveProfile() {
		busy = 'profile';
		msg = null;
		const r = await fetch('/api/profile', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ displayName, avatarEmoji })
		});
		busy = null;
		if (!r.ok) {
			msg = `Profile save failed: ${r.status}`;
			return;
		}
		msg = 'Profile saved.';
		await invalidateAll();
	}

	async function saveCouple() {
		if (!data.couple) return;
		busy = 'couple';
		msg = null;
		const r = await fetch('/api/couple', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				nickname: nickname.trim() ? nickname : null,
				anniversary: anniversary || null
			})
		});
		busy = null;
		if (!r.ok) {
			msg = `Couple save failed: ${r.status}`;
			return;
		}
		msg = 'Saved.';
		await invalidateAll();
	}

	async function toggleGhost(next: boolean) {
		ghost = next;
		await fetch('/api/location/ghost', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ enabled: next })
		});
	}

	let confirmUnpair = $state(false);
	async function doUnpair() {
		busy = 'unpair';
		await fetch('/api/couple', { method: 'DELETE' });
		busy = null;
		await goto('/onboarding/link');
	}
</script>

<svelte:head>
	<title>Settings · DuoSync</title>
</svelte:head>

<div class="mx-auto max-w-md space-y-6 p-4">
	<header>
		<h1 class="text-2xl font-semibold">Settings</h1>
		<p class="mt-1 text-sm text-base-content/60">{data.me.email}</p>
	</header>

	{#if msg}<div class="alert text-sm alert-info">{msg}</div>{/if}

	<section class="card bg-base-200 shadow-sm">
		<div class="card-body space-y-3 p-4">
			<h2 class="card-title text-base">You</h2>
			<label class="form-control">
				<div class="label"><span class="label-text">Display name</span></div>
				<input bind:value={displayName} maxlength="40" class="input-bordered input" />
			</label>
			<label class="form-control">
				<div class="label"><span class="label-text">Avatar emoji</span></div>
				<input
					bind:value={avatarEmoji}
					maxlength="8"
					class="input-bordered input"
					placeholder="🌱"
				/>
			</label>
			<button class="btn btn-sm btn-primary" disabled={busy === 'profile'} onclick={saveProfile}>
				{busy === 'profile' ? 'Saving…' : 'Save profile'}
			</button>
		</div>
	</section>

	<section class="card bg-base-200 shadow-sm">
		<div class="card-body space-y-3 p-4">
			<h2 class="card-title text-base">Privacy</h2>
			<label class="label cursor-pointer justify-between">
				<span>
					<span class="label-text font-medium">Ghost mode</span>
					<span class="mt-0.5 block text-xs text-base-content/60">
						Hide your location from your partner. They'll see "ghosted" instead of distance.
					</span>
				</span>
				<input
					type="checkbox"
					class="toggle toggle-primary"
					checked={ghost}
					onchange={(e) => toggleGhost((e.currentTarget as HTMLInputElement).checked)}
				/>
			</label>
		</div>
	</section>

	{#if data.couple}
		<section class="card bg-base-200 shadow-sm">
			<div class="card-body space-y-3 p-4">
				<h2 class="card-title text-base">Us</h2>
				<p class="text-xs text-base-content/60">
					Paired with {data.partner?.avatarEmoji ?? '💞'}
					{data.partner?.displayName ?? 'your partner'}
				</p>
				<label class="form-control">
					<div class="label"><span class="label-text">Nickname for the two of you</span></div>
					<input
						bind:value={nickname}
						maxlength="60"
						class="input-bordered input"
						placeholder="e.g. 我們"
					/>
				</label>
				<label class="form-control">
					<div class="label">
						<span class="label-text">Anniversary</span>
						<span class="label-text-alt text-base-content/60">YYYY-MM-DD</span>
					</div>
					<input bind:value={anniversary} type="date" class="input-bordered input" />
				</label>
				<button class="btn btn-sm btn-primary" disabled={busy === 'couple'} onclick={saveCouple}>
					{busy === 'couple' ? 'Saving…' : 'Save us'}
				</button>
			</div>
		</section>

		<section class="card border border-error/30 bg-error/10 shadow-sm">
			<div class="card-body space-y-3 p-4">
				<h2 class="card-title text-base text-error">Unpair</h2>
				<p class="text-xs text-base-content/70">
					Ends the connection. Your shared history stays on the server until DB cleanup. You'll
					return to the link-code screen.
				</p>
				{#if !confirmUnpair}
					<button class="btn btn-sm btn-error" onclick={() => (confirmUnpair = true)}>
						Unpair…
					</button>
				{:else}
					<div class="flex gap-2">
						<button class="btn btn-sm btn-error" disabled={busy === 'unpair'} onclick={doUnpair}>
							{busy === 'unpair' ? 'Unpairing…' : 'Yes, unpair'}
						</button>
						<button class="btn btn-ghost btn-sm" onclick={() => (confirmUnpair = false)}>
							Cancel
						</button>
					</div>
				{/if}
			</div>
		</section>
	{/if}

	<form method="POST" action="/auth/sign-out">
		<button class="btn btn-block btn-ghost" type="submit">Sign out</button>
	</form>
</div>
