<!--
  /onboarding — name + avatar emoji + anniversary (U6e).

  Visual rebuild only — the form action contract is unchanged so
  +page.server.ts works as-is. Mood input is intentionally deferred
  (see plan.md §11.11 #3 + MoodWeather TODO in /pulse).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/ui/Icon.svelte';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const emojis = ['💗', '🌸', '🦋', '🌙', '⭐', '🔥', '🌊', '🍀', '🐱', '🐶', '🌻', '🍵'];
	let pickedEmoji = $state(data.profile?.avatarEmoji ?? emojis[0]);
</script>

<svelte:head>
	<title>關於你 · DuoSync</title>
</svelte:head>

<main class="bg-base-100 min-h-screen px-5 py-10">
	<div class="mx-auto max-w-md">
		<div class="text-center">
			<div
				class="bg-primary/10 text-primary animate-breathe mx-auto grid h-14 w-14 place-items-center rounded-full"
			>
				<Icon icon={HeartIcon} size={26} weight="duotone" />
			</div>
			<h1 class="text-display mt-4 text-3xl font-semibold tracking-wide">關於你</h1>
			<p class="text-base-content/60 mt-2 text-sm">只是基本資料. 之後都可改.</p>
		</div>

		<form method="post" use:enhance class="mt-8 space-y-6">
			<label class="block">
				<span class="text-base-content/70 mb-1.5 block text-xs tracking-wider uppercase"
					>顯示名</span
				>
				<input
					class="bg-base-200 border-base-content/10 focus:border-primary w-full rounded-[var(--radius-card)] border px-4 py-3 text-base outline-none"
					type="text"
					name="displayName"
					required
					value={data.profile?.displayName ?? data.name ?? ''}
					autocomplete="nickname"
				/>
			</label>

			<label class="block">
				<span class="text-base-content/70 mb-1.5 block text-xs tracking-wider uppercase">
					稱謂 <span class="text-base-content/40 normal-case">(選填)</span>
				</span>
				<input
					class="bg-base-200 border-base-content/10 focus:border-primary w-full rounded-[var(--radius-card)] border px-4 py-3 text-base outline-none"
					type="text"
					name="pronouns"
					value={data.profile?.pronouns ?? ''}
					placeholder="she/her, he/him, they/them…"
				/>
			</label>

			<fieldset>
				<legend class="text-base-content/70 mb-2 text-xs tracking-wider uppercase">挑頭像</legend>
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
								class="grid h-12 w-12 place-items-center rounded-full border-2 border-transparent text-2xl transition-all peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:scale-110"
								>{e}</span
							>
						</label>
					{/each}
				</div>
			</fieldset>

			<label class="block">
				<span class="text-base-content/70 mb-1.5 block text-xs tracking-wider uppercase">
					紀念日 <span class="text-base-content/40 normal-case">(選填)</span>
				</span>
				<input
					class="bg-base-200 border-base-content/10 focus:border-primary w-full rounded-[var(--radius-card)] border px-4 py-3 text-base outline-none"
					type="date"
					name="anniversary"
				/>
			</label>

			{#if form?.error}
				<div class="bg-error/10 text-error rounded-[var(--radius-card)] px-4 py-3 text-sm">
					{form.error}
				</div>
			{/if}

			<button
				class="bg-primary text-primary-content shadow-paper w-full rounded-full py-3.5 text-base font-semibold tracking-wider uppercase transition-transform active:scale-[0.98]"
				type="submit"
			>
				繼續 →
			</button>
		</form>
	</div>
</main>
