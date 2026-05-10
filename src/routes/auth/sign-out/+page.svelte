<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { purgeUserCaches } from '$lib/pwa/register';
</script>

<svelte:head>
	<title>{m.auth_signout_title()} — DuoSync</title>
</svelte:head>

<main class="hero min-h-screen px-4">
	<form
		method="POST"
		use:enhance={() => {
			// Purge user-scoped caches BEFORE the redirect lands, so the
			// next paint on a shared device can't surface this user's data.
			// Returning the callback defers SvelteKit's default
			// update()/redirect handling until after our purge resolves.
			return async ({ update }) => {
				await purgeUserCaches();
				await update();
			};
		}}
		class="card bg-base-100 p-8 shadow"
	>
		<p class="mb-4">{m.auth_signout_confirm()}</p>
		<button class="btn btn-primary" type="submit">{m.auth_signout_button()}</button>
	</form>
</main>
