<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
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

<main class="flex min-h-[100dvh] items-center justify-center bg-base-200 px-4 py-10">
	<div
		class="w-full max-w-sm space-y-6 rounded-[var(--radius-card)] border border-base-content/5 bg-base-100 p-7 shadow-paper"
	>
		<header class="space-y-3 text-center">
			<div
				class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/12 text-primary"
			>
				<Icon icon={HeartIcon} size={24} weight="duotone" />
			</div>
			<h1 class="text-display text-3xl font-semibold tracking-wide">
				{mode === 'signup' ? m.auth_signup_heading() : m.auth_signin_heading()}
			</h1>
			<p class="text-sm text-base-content/70">
				{mode === 'signup' ? m.auth_signup_subtitle() : m.auth_signin_subtitle()}
			</p>
		</header>

		<div
			role="tablist"
			class="grid grid-cols-2 gap-1 rounded-full border border-base-content/5 bg-base-200 p-1 text-xs font-semibold tracking-wider uppercase"
		>
			<button
				role="tab"
				aria-selected={mode === 'login'}
				class="rounded-full py-2 transition-colors"
				class:bg-primary={mode === 'login'}
				class:text-primary-content={mode === 'login'}
				class:text-base-content={mode !== 'login'}
				onclick={() => (mode = 'login')}
				type="button">{m.auth_tab_signin()}</button
			>
			<button
				role="tab"
				aria-selected={mode === 'signup'}
				class="rounded-full py-2 transition-colors"
				class:bg-primary={mode === 'signup'}
				class:text-primary-content={mode === 'signup'}
				class:text-base-content={mode !== 'signup'}
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
			class="space-y-4"
		>
			<label class="block space-y-1.5">
				<span class="text-xs font-semibold tracking-wider text-base-content/70 uppercase"
					>{m.auth_email_label()}</span
				>
				<input
					class="w-full rounded-[var(--radius-field)] border border-base-content/10 bg-base-200/60 px-3.5 py-2.5 text-base outline-none focus:border-primary"
					type="email"
					name="email"
					bind:value={email}
					autocomplete="email"
					placeholder={m.auth_email_placeholder()}
					required
				/>
			</label>

			<label class="block space-y-1.5">
				<span class="text-xs font-semibold tracking-wider text-base-content/70 uppercase"
					>{m.auth_password_label()}</span
				>
				<input
					class="w-full rounded-[var(--radius-field)] border border-base-content/10 bg-base-200/60 px-3.5 py-2.5 text-base outline-none focus:border-primary"
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

			<PillButton type="submit" block disabled={busy}>
				{#if busy}
					{mode === 'signup' ? m.auth_creating() : m.auth_signing_in()}
				{:else}
					{mode === 'signup' ? m.auth_signup_title() : m.auth_signin_title()}
				{/if}
			</PillButton>
		</form>

		{#if form?.error}
			<div
				class="rounded-[var(--radius-field)] border border-error/30 bg-error/10 px-3 py-2.5 text-sm text-error"
			>
				{form.error}
			</div>
		{/if}
	</div>
</main>
