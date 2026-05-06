<script lang="ts">
	import { enhance } from '$app/forms';
</script>

<svelte:head>
	<title>Sign out — DuoSync</title>
</svelte:head>

<main class="hero min-h-screen px-4">
	<form method="POST" use:enhance class="card bg-base-100 p-8 shadow">
		<p class="mb-4">Are you sure you want to sign out?</p>
		<button class="btn btn-primary" type="submit">Sign out</button>
	</form>
</main>
