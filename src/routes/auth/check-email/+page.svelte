<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.auth_check_email_title()} — DuoSync</title>
</svelte:head>

<main class="hero min-h-screen bg-base-200 px-4">
	<div class="card max-w-md bg-base-100 shadow-paper">
		<div class="card-body text-center">
			<h1 class="text-2xl font-semibold">{m.auth_check_email_title()}</h1>
			<p class="mt-2 text-sm text-base-content/70">
				{m.auth_check_email_body()}
			</p>
		</div>
	</div>
</main>
