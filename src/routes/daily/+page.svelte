<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
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
			<label class="form-control">
				<div class="label">
					<span class="label-text">{m.daily_answer_label()}</span>
					<span class="label-text-alt text-base-content/60">{body.length}/1000</span>
				</div>
				<textarea
					bind:value={body}
					maxlength={1000}
					rows={5}
					placeholder={m.daily_placeholder()}
					class="textarea-bordered textarea"
				></textarea>
			</label>
			{#if err}<p class="text-sm text-error">{err}</p>{/if}
			<button
				class="btn btn-block btn-primary"
				disabled={submitting || !body.trim()}
				onclick={submit}
			>
				{submitting ? m.daily_saving() : m.daily_send()}
			</button>
		</section>
	{:else}
		<section class="mt-6 space-y-4">
			<article class="card bg-base-200 shadow-sm">
				<div class="card-body p-4">
					<header class="flex items-center justify-between">
						<span class="text-sm font-semibold">{m.daily_you()}</span>
						<time class="text-xs text-base-content/60">{fmtTime(mine.createdAt)}</time>
					</header>
					<p class="mt-2 whitespace-pre-wrap">{mine.body}</p>
				</div>
			</article>

			{#if revealed && partner}
				<article class="card bg-base-200 shadow-sm">
					<div class="card-body p-4">
						<header class="flex items-center justify-between">
							<span class="text-sm font-semibold">
								{data.partner?.avatarEmoji ?? '💞'}
								{data.partner?.displayName ?? m.pulse_partner_fallback()}
							</span>
							<time class="text-xs text-base-content/60">{fmtTime(partner.createdAt)}</time>
						</header>
						<p class="mt-2 whitespace-pre-wrap">{partner.body}</p>
					</div>
				</article>
			{:else}
				<div class="card border border-dashed border-base-300 bg-base-200/60 shadow-sm">
					<div class="card-body items-center p-4 text-center">
						<p class="text-sm text-base-content/70">
							{m.daily_waiting({ name: data.partner?.displayName ?? m.daily_partner_fallback() })}
						</p>
						<p class="mt-1 text-xs text-base-content/50">
							{m.daily_unlock_hint()}
						</p>
					</div>
				</div>
			{/if}
		</section>
	{/if}
</main>
