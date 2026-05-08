<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
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
	<title>{mode === 'signup' ? m.auth_signup_title() : m.auth_signin_title()} — DuoSync</title>
</svelte:head>

<main class="hero min-h-screen bg-base-200 px-4">
	<div class="card w-full max-w-md bg-base-100 shadow-paper">
		<div class="card-body">
			<h1 class="text-3xl font-semibold tracking-tight">
				{mode === 'signup' ? m.auth_signup_heading() : m.auth_signin_heading()}
			</h1>
			<p class="mt-1 text-sm text-base-content/70">
				{mode === 'signup' ? m.auth_signup_subtitle() : m.auth_signin_subtitle()}
			</p>

			<div role="tablist" class="tabs-boxed mt-4 tabs">
				<button
					role="tab"
					class="tab"
					class:tab-active={mode === 'login'}
					onclick={() => (mode = 'login')}
					type="button">{m.auth_tab_signin()}</button
				>
				<button
					role="tab"
					class="tab"
					class:tab-active={mode === 'signup'}
					onclick={() => (mode = 'signup')}
					type="button">{m.auth_tab_signup()}</button
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
					<span class="label-text">{m.auth_email_label()}</span>
					<input
						class="input-bordered input"
						type="email"
						name="email"
						bind:value={email}
						autocomplete="email"
						placeholder={m.auth_email_placeholder()}
						required
					/>
				</label>

				<label class="form-control mt-2 w-full">
					<span class="label-text">{m.auth_password_label()}</span>
					<input
						class="input-bordered input"
						type="password"
						name="password"
						autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
						placeholder={mode === 'signup'
							? m.auth_password_placeholder_signup()
							: m.auth_password_placeholder_signin()}
						minlength={mode === 'signup' ? 8 : undefined}
						required
					/>
				</label>

				<button class="btn mt-4 btn-primary" disabled={busy} type="submit">
					{#if busy}
						…
					{:else}
						{mode === 'signup' ? m.auth_signup_title() : m.auth_signin_title()}
					{/if}
				</button>
			</form>

			{#if form?.error}
				<div class="mt-4 alert text-sm alert-error">{form.error}</div>
			{/if}
		</div>
	</div>
</main>
