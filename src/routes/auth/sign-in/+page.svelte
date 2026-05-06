<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient, signIn, signUp } from '$lib/auth-client';

	let busy = $state(false);
	let error = $state<string | null>(null);
	let mode = $state<'register' | 'login'>('login');
	// Most users without WebAuthn will start with password — promote it as default.
	let method = $state<'password' | 'passkey'>('password');
	let name = $state('');
	let email = $state('');
	let password = $state('');

	function describe(e: unknown): string {
		if (e instanceof Error) return e.message;
		if (typeof e === 'string') return e;
		try {
			return JSON.stringify(e);
		} catch {
			return 'Unexpected error';
		}
	}

	async function passwordRegister() {
		busy = true;
		error = null;
		try {
			if (!name.trim() || !email.trim() || password.length < 8) {
				error = 'Name, email and an 8+ character password are required';
				return;
			}
			const res = await signUp.email({ name, email, password });
			if (res.error) {
				error = res.error.message ?? 'Sign-up failed';
				return;
			}
			await goto('/onboarding');
		} catch (e) {
			error = describe(e);
		} finally {
			busy = false;
		}
	}

	async function passwordLogin() {
		busy = true;
		error = null;
		try {
			if (!email.trim() || !password) {
				error = 'Email and password are required';
				return;
			}
			const res = await signIn.email({ email, password });
			if (res.error) {
				error = res.error.message ?? 'Sign-in failed';
				return;
			}
			await goto('/pulse');
		} catch (e) {
			error = describe(e);
		} finally {
			busy = false;
		}
	}

	async function passkeyRegister() {
		busy = true;
		error = null;
		try {
			if (!name.trim() || !email.trim()) {
				error = 'Name and email are required';
				return;
			}
			const signUpRes = await authClient.signUp.email({
				name,
				email,
				password: crypto.randomUUID()
			});
			if (signUpRes.error) {
				error = signUpRes.error.message ?? 'Sign-up failed';
				return;
			}
			const reg = await authClient.passkey.addPasskey();
			if (reg?.error) {
				error = reg.error.message ?? 'Passkey registration failed';
				return;
			}
			await goto('/onboarding');
		} catch (e) {
			error = describe(e);
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
			error = describe(e);
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
			error = describe(e);
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
				Sign in with email + password, or use a passkey if your device supports it.
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

			<form
				class="contents"
				onsubmit={(e) => {
					e.preventDefault();
					if (method === 'password') {
						mode === 'register' ? passwordRegister() : passwordLogin();
					} else {
						mode === 'register' ? passkeyRegister() : passkeyLogin();
					}
				}}
			>
				{#if mode === 'register'}
					<label class="form-control mt-4 w-full">
						<span class="label-text">Name</span>
						<input
							class="input-bordered input"
							type="text"
							bind:value={name}
							autocomplete="name"
							placeholder="Your name"
							required
						/>
					</label>
				{/if}

				<label class="form-control mt-2 w-full">
					<span class="label-text">Email</span>
					<input
						class="input-bordered input"
						type="email"
						bind:value={email}
						autocomplete="email"
						placeholder="you@example.com"
						required
					/>
				</label>

				{#if method === 'password'}
					<label class="form-control mt-2 w-full">
						<span class="label-text">Password</span>
						<input
							class="input-bordered input"
							type="password"
							bind:value={password}
							autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
							placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
							minlength={mode === 'register' ? 8 : undefined}
							required
						/>
					</label>
				{/if}

				<button class="btn mt-4 btn-primary" disabled={busy} type="submit">
					{#if busy}
						…
					{:else if method === 'password'}
						{mode === 'register' ? 'Create account' : 'Sign in'}
					{:else}
						{mode === 'register' ? 'Create account + add passkey' : 'Sign in with passkey'}
					{/if}
				</button>
			</form>

			<button
				class="link-hover btn-link btn mt-2 btn-sm justify-self-center"
				type="button"
				onclick={() => (method = method === 'password' ? 'passkey' : 'password')}
			>
				{method === 'password' ? 'Use a passkey instead' : 'Use email + password instead'}
			</button>

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
