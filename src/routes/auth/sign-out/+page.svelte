<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.auth_signout_title()} — DuoSync</title>
</svelte:head>

<main class="hero min-h-screen px-4">
	<form method="POST" use:enhance class="card bg-base-100 p-8 shadow">
		<p class="mb-4">{m.auth_signout_confirm()}</p>
		<button class="btn btn-primary" type="submit">{m.auth_signout_button()}</button>
	</form>
</main>
