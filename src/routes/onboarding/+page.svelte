<!--
  /onboarding — name + avatar emoji + anniversary (U6e).

  Visual rebuild only — the form action contract is unchanged so
  +page.server.ts works as-is. Mood input is intentionally deferred
  (see plan.md §11.11 #3 + MoodWeather TODO in /pulse).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/ui/Icon.svelte';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const emojis = ['💗', '🌸', '🦋', '🌙', '⭐', '🔥', '🌊', '🍀', '🐱', '🐶', '🌻', '🍵'];
	let pickedEmoji = $state(untrack(() => data.profile?.avatarEmoji ?? emojis[0]));
</script>

<svelte:head>
	<title>{m.onboarding_title()} · DuoSync</title>
</svelte:head>

<main class="min-h-screen bg-base-100 px-5 py-10">
	<div class="mx-auto max-w-md">
		<div class="text-center">
			<div
				class="animate-breathe mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary"
			>
				<Icon icon={HeartIcon} size={26} weight="duotone" />
			</div>
			<h1 class="text-display mt-4 text-3xl font-semibold tracking-wide">{m.onboarding_title()}</h1>
			<p class="mt-2 text-sm text-base-content/60">{m.onboarding_subtitle()}</p>
		</div>

		<form method="post" use:enhance class="mt-8 space-y-6">
			<label class="block">
				<span class="mb-1.5 block text-xs tracking-wider text-base-content/70 uppercase"
					>{m.onboarding_form_displayname()}</span
				>
				<input
					class="w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-200 px-4 py-3 text-base outline-none focus:border-primary"
					type="text"
					name="displayName"
					required
					value={data.profile?.displayName ?? data.name ?? ''}
					autocomplete="nickname"
				/>
			</label>

			<label class="block">
				<span class="mb-1.5 block text-xs tracking-wider text-base-content/70 uppercase">
					{m.onboarding_form_pronouns()}
					<span class="text-base-content/40 normal-case">{m.onboarding_form_optional()}</span>
				</span>
				<input
					class="w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-200 px-4 py-3 text-base outline-none focus:border-primary"
					type="text"
					name="pronouns"
					value={data.profile?.pronouns ?? ''}
					placeholder="she/her, he/him, they/them…"
				/>
			</label>

			<fieldset>
				<legend class="mb-2 text-xs tracking-wider text-base-content/70 uppercase"
					>{m.onboarding_pick_avatar()}</legend
				>
				<div class="grid grid-cols-6 gap-2">
					{#each emojis as e (e)}
						<label class="flex cursor-pointer items-center justify-center">
							<input
								type="radio"
								name="avatarEmoji"
								value={e}
								class="peer sr-only"
								checked={pickedEmoji === e}
								onchange={() => (pickedEmoji = e)}
							/>
							<span
								class="grid h-12 w-12 place-items-center rounded-full border-2 border-transparent text-2xl transition-all peer-checked:scale-110 peer-checked:border-primary peer-checked:bg-primary/10"
								>{e}</span
							>
						</label>
					{/each}
				</div>
			</fieldset>

			<label class="block">
				<span class="mb-1.5 block text-xs tracking-wider text-base-content/70 uppercase">
					{m.onboarding_form_anniversary()}
					<span class="text-base-content/40 normal-case">{m.onboarding_form_optional()}</span>
				</span>
				<input
					class="w-full rounded-[var(--radius-card)] border border-base-content/10 bg-base-200 px-4 py-3 text-base outline-none focus:border-primary"
					type="date"
					name="anniversary"
				/>
			</label>

			{#if form?.error}
				<div class="rounded-[var(--radius-card)] bg-error/10 px-4 py-3 text-sm text-error">
					{form.error}
				</div>
			{/if}

			<button
				class="w-full rounded-full bg-primary py-3.5 text-base font-semibold tracking-wider text-primary-content uppercase shadow-paper transition-transform active:scale-[0.98]"
				type="submit"
			>
				{m.onboarding_continue()} →
			</button>
		</form>
	</div>
</main>
