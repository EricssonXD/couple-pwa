<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const emojis = ['💗', '🌸', '🦋', '🌙', '⭐', '🔥', '🌊', '🍀', '🐱', '🐶', '🌻', '🍵'];
	let pickedEmoji = $state(data.profile?.avatarEmoji ?? emojis[0]);
</script>

<svelte:head>
	<title>About you — DuoSync</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 py-10">
	<h1 class="text-3xl font-semibold tracking-tight">About you</h1>
	<p class="mt-2 text-sm text-base-content/70">Just the basics. You can change anything later.</p>

	<form method="post" use:enhance class="mt-6 space-y-4">
		<label class="form-control w-full">
			<span class="label-text">Display name</span>
			<input
				class="input-bordered input"
				type="text"
				name="displayName"
				required
				value={data.profile?.displayName ?? data.name ?? ''}
				autocomplete="nickname"
			/>
		</label>

		<label class="form-control w-full">
			<span class="label-text">Pronouns <span class="text-base-content/50">(optional)</span></span>
			<input
				class="input-bordered input"
				type="text"
				name="pronouns"
				value={data.profile?.pronouns ?? ''}
				placeholder="she/her, he/him, they/them…"
			/>
		</label>

		<fieldset>
			<legend class="label-text">Pick an avatar emoji</legend>
			<div class="mt-2 grid grid-cols-6 gap-2">
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
							class="flex h-12 w-12 items-center justify-center rounded-box border-2 border-transparent text-2xl peer-checked:border-rose-500 peer-checked:bg-rose-50"
							>{e}</span
						>
					</label>
				{/each}
			</div>
		</fieldset>

		<label class="form-control w-full">
			<span class="label-text">
				Anniversary <span class="text-base-content/50">(optional)</span>
			</span>
			<input class="input-bordered input" type="date" name="anniversary" />
		</label>

		{#if form?.error}
			<div class="alert text-sm alert-error">{form.error}</div>
		{/if}

		<button class="btn w-full btn-primary" type="submit">Continue</button>
	</form>
</main>
