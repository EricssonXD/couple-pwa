<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient, signIn } from '$lib/auth-client';

	let busy = $state(false);
	let error = $state<string | null>(null);
	let mode = $state<'register' | 'login'>('login');
	let name = $state('');
	let email = $state('');

	async function passkeyRegister() {
		busy = true;
		error = null;
		try {
			if (!name.trim() || !email.trim()) {
				error = 'Name and email are required';
				return;
			}
			// Sign up creates the user record without password (passkey-only).
			const signUp = await authClient.signUp.email({
				name,
				email,
				password: crypto.randomUUID() // random throwaway — passkey is the real credential
			});
			if (signUp.error) {
				error = signUp.error.message ?? 'Sign-up failed';
				return;
			}
			const reg = await authClient.passkey.addPasskey();
			if (reg?.error) {
				error = reg.error.message ?? 'Passkey registration failed';
				return;
			}
			await goto('/onboarding');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unexpected error';
		} finally {
			busy = false;
		}
	}

	async function passkeyLogin() {
		busy = true;
		error = null;
		try {
			const res = await signIn.passkey();
			if (res?.error) {
				error = res.error.message ?? 'Sign-in failed';
				return;
			}
			await goto('/pulse');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unexpected error';
		} finally {
			busy = false;
		}
	}

	async function googleLogin() {
		busy = true;
		error = null;
		try {
			await signIn.social({ provider: 'google', callbackURL: '/pulse' });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unexpected error';
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in — DuoSync</title>
</svelte:head>

<main class="hero min-h-screen bg-gradient-to-b from-rose-50 to-violet-50 px-4">
	<div class="card w-full max-w-md bg-base-100 shadow-xl">
		<div class="card-body">
			<h1 class="text-3xl font-semibold tracking-tight">Welcome back</h1>
			<p class="mt-1 text-sm text-base-content/70">
				Passkeys keep DuoSync private — no passwords, no email checks.
			</p>

			<div role="tablist" class="tabs-boxed mt-4 tabs">
				<button
					role="tab"
					class="tab"
					class:tab-active={mode === 'login'}
					onclick={() => (mode = 'login')}>Sign in</button
				>
				<button
					role="tab"
					class="tab"
					class:tab-active={mode === 'register'}
					onclick={() => (mode = 'register')}>Create account</button
				>
			</div>

			{#if mode === 'register'}
				<label class="form-control mt-4 w-full">
					<span class="label-text">Name</span>
					<input
						class="input-bordered input"
						type="text"
						bind:value={name}
						autocomplete="name"
						placeholder="Your name"
					/>
				</label>
				<label class="form-control mt-2 w-full">
					<span class="label-text">Email</span>
					<input
						class="input-bordered input"
						type="email"
						bind:value={email}
						autocomplete="email"
						placeholder="you@example.com"
					/>
				</label>
				<button
					class="btn mt-4 btn-primary"
					disabled={busy}
					onclick={passkeyRegister}
					type="button"
				>
					{busy ? 'Creating…' : 'Create account + add passkey'}
				</button>
			{:else}
				<button class="btn mt-4 btn-primary" disabled={busy} onclick={passkeyLogin} type="button">
					{busy ? '…' : 'Sign in with passkey'}
				</button>
			{/if}

			<div class="divider text-xs text-base-content/50">or</div>

			<button class="btn btn-outline" disabled={busy} onclick={googleLogin} type="button">
				Continue with Google
			</button>

			{#if error}
				<div class="mt-4 alert text-sm alert-error">{error}</div>
			{/if}
		</div>
	</div>
</main>
