<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card.svelte';
	import InputField from '$lib/components/ui/InputField.svelte';
	import Notice from '$lib/components/ui/Notice.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let body = $state('');
	let submitting = $state(false);
	let err = $state<string | null>(null);

	const daily = $derived(data.daily);
	const mine = $derived(daily.mine);
	const partner = $derived(daily.partner);
	const revealed = $derived(daily.revealed);

	async function submit() {
		const trimmed = body.trim();
		if (!trimmed) return;
		submitting = true;
		err = null;
		const r = await fetch('/api/daily', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ body: trimmed })
		});
		submitting = false;
		if (!r.ok) {
			err = m.daily_save_error({ status: String(r.status) });
			return;
		}
		body = '';
		await invalidateAll();
	}

	function fmtTime(iso: string | Date) {
		const d = typeof iso === 'string' ? new Date(iso) : iso;
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>{m.daily_title_tag()}</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-8">
	<header class="mb-4">
		<p class="text-xs tracking-wider text-base-content/60 uppercase">{m.daily_heading()}</p>
		<h1 class="text-display text-3xl font-semibold tracking-wide">{daily.dateKey}</h1>
	</header>

	<section
		class="rounded-[var(--radius-card)] border border-base-content/5 bg-gradient-to-br from-primary/10 to-accent/10 p-5 shadow-paper"
	>
		<p class="text-lg leading-relaxed font-medium">{daily.question.promptEn}</p>
		{#if daily.question.promptZh}
			<p class="mt-1 text-base text-base-content/70">{daily.question.promptZh}</p>
		{/if}
	</section>

	{#if !mine}
		<section class="mt-6 space-y-3">
			<div class="flex items-baseline justify-between">
				<span class="text-xs tracking-wider text-base-content/70 uppercase"
					>{m.daily_answer_label()}</span
				>
				<span class="text-[10px] text-base-content/40">{body.length}/1000</span>
			</div>
			<InputField bind:value={body} maxlength={1000} rows={5} placeholder={m.daily_placeholder()} />
			{#if err}
				<Notice>{err}</Notice>
			{/if}
			<button
				class="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-xs font-semibold tracking-wider text-primary-content uppercase shadow-paper transition-opacity disabled:opacity-50"
				disabled={submitting || !body.trim()}
				onclick={submit}
			>
				{#if submitting}
					<Spinner />
					{m.daily_saving()}
				{:else}
					{m.daily_send()}
				{/if}
			</button>
		</section>
	{:else}
		<section class="mt-6 space-y-4">
			<Card>
				<header class="flex items-center justify-between">
					<span class="text-xs font-semibold tracking-wider uppercase">{m.daily_you()}</span>
					<time class="text-xs text-base-content/55">{fmtTime(mine.createdAt)}</time>
				</header>
				<p class="mt-2 leading-relaxed whitespace-pre-wrap">{mine.body}</p>
			</Card>

			{#if revealed && partner}
				<Card>
					<header class="flex items-center justify-between">
						<span class="text-xs font-semibold tracking-wider uppercase">
							{data.partner?.avatarEmoji ?? '💞'}
							{data.partner?.displayName ?? m.pulse_partner_fallback()}
						</span>
						<time class="text-xs text-base-content/55">{fmtTime(partner.createdAt)}</time>
					</header>
					<p class="mt-2 leading-relaxed whitespace-pre-wrap">{partner.body}</p>
				</Card>
			{:else}
				<Card class="border-dashed text-center">
					<p class="text-sm text-base-content/70">
						{m.daily_waiting({ name: data.partner?.displayName ?? m.daily_partner_fallback() })}
					</p>
					<p class="mt-1 text-xs text-base-content/50">
						{m.daily_unlock_hint()}
					</p>
				</Card>
			{/if}
		</section>
	{/if}
</main>
