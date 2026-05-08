<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let mode = $state<'login' | 'signup'>(
		untrack(
			() => ((form?.mode as 'login' | 'signup' | undefined) ?? data.mode) as 'login' | 'signup'
		)
	);
	let email = $state(untrack(() => (form?.email as string) ?? ''));
	let busy = $state(false);
</script>

<svelte:head>
	<title>{mode === 'signup' ? 'Create account' : 'Sign in'} — DuoSync</title>
</svelte:head>

<main class="hero min-h-screen bg-gradient-to-b from-rose-50 to-violet-50 px-4">
	<div class="card w-full max-w-md bg-base-100 shadow-xl">
		<div class="card-body">
			<h1 class="text-3xl font-semibold tracking-tight">
				{mode === 'signup' ? 'Create your account' : 'Welcome back'}
			</h1>
			<p class="mt-1 text-sm text-base-content/70">
				{mode === 'signup'
					? 'One account per person. Pair up after sign-up.'
					: 'Sign in with your email and password.'}
			</p>

			<div role="tablist" class="tabs-boxed mt-4 tabs">
				<button
					role="tab"
					class="tab"
					class:tab-active={mode === 'login'}
					onclick={() => (mode = 'login')}
					type="button">Sign in</button
				>
				<button
					role="tab"
					class="tab"
					class:tab-active={mode === 'signup'}
					onclick={() => (mode = 'signup')}
					type="button">Create account</button
				>
			</div>

			<form
				method="POST"
				action={mode === 'signup' ? '?/signup' : '?/login'}
				use:enhance={() => {
					busy = true;
					return ({ update }) => update().finally(() => (busy = false));
				}}
				class="contents"
			>
				<label class="form-control mt-4 w-full">
					<span class="label-text">Email</span>
					<input
						class="input-bordered input"
						type="email"
						name="email"
						bind:value={email}
						autocomplete="email"
						placeholder="you@example.com"
						required
					/>
				</label>

				<label class="form-control mt-2 w-full">
					<span class="label-text">Password</span>
					<input
						class="input-bordered input"
						type="password"
						name="password"
						autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
						placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
						minlength={mode === 'signup' ? 8 : undefined}
						required
					/>
				</label>

				<button class="btn mt-4 btn-primary" disabled={busy} type="submit">
					{#if busy}
						…
					{:else}
						{mode === 'signup' ? 'Create account' : 'Sign in'}
					{/if}
				</button>
			</form>

			{#if form?.error}
				<div class="mt-4 alert text-sm alert-error">{form.error}</div>
			{/if}
		</div>
	</div>
</main>
