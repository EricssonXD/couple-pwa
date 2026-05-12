<!--
  StreakBadge — small chip showing the couple's current connection streak.

  Pure presenter: server computes the streak via getStreak(); we just render.
  Hidden when streak === 0 to avoid nagging new couples.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';

	type Props = { streak: number };
	let { streak }: Props = $props();
</script>

{#if streak > 0}
	<div
		class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
		title={m.streak_tooltip()}
	>
		<span aria-hidden="true">🔥</span>
		<span>{m.streak_label({ n: streak })}</span>
	</div>
{/if}
