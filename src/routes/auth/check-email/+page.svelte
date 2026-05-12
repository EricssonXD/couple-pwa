<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import EnvelopeIcon from 'phosphor-svelte/lib/EnvelopeIcon';
	import Icon from '$lib/components/ui/Icon.svelte';
</script>

<svelte:head>
	<title>{m.auth_check_email_title()} — DuoSync</title>
</svelte:head>

<main class="flex min-h-[100dvh] items-center justify-center bg-base-200 px-4 py-10">
	<div
		class="w-full max-w-sm space-y-5 rounded-[var(--radius-card)] border border-base-content/5 bg-base-100 p-7 text-center shadow-paper"
	>
		<div
			class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/12 text-primary"
		>
			<Icon icon={EnvelopeIcon} size={28} weight="duotone" />
		</div>
		<h1 class="text-display text-2xl font-semibold tracking-wide">
			{m.auth_check_email_title()}
		</h1>
		<p class="text-sm leading-relaxed text-base-content/70">
			{m.auth_check_email_body()}
		</p>
		<p class="text-xs text-base-content/55">
			{m.auth_check_email_resend()}
		</p>
		<a
			href={resolve('/auth/sign-in')}
			class="inline-flex items-center justify-center rounded-full border border-base-content/10 bg-base-200/60 px-5 py-2 text-xs font-semibold tracking-wider uppercase transition-colors hover:bg-base-200"
		>
			{m.auth_check_email_back()}
		</a>
	</div>
</main>
