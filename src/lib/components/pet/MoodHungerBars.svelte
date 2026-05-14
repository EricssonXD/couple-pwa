<!--
  MoodHungerBars — twin sketchy progress bars used on the /pet habitat.

  Mood is bounded MOOD_FLOOR..MOOD_CEIL (20..100); hunger is
  HUNGER_FLOOR..HUNGER_CEIL (0..80). Both render as 0..100% width;
  hunger displays as "fullness" (low hunger ⇒ full bar) so a hungry
  pet's bar visually drains.

  Props:
    - mood     number
    - hunger   number
    - class    passthrough
-->
<script lang="ts">
	import { MOOD_FLOOR, MOOD_CEIL, HUNGER_FLOOR, HUNGER_CEIL } from '$lib/pet.constants';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		mood: number;
		hunger: number;
		class?: string;
	}

	let { mood, hunger, class: className = '' }: Props = $props();

	const moodPct = $derived(Math.round(((mood - MOOD_FLOOR) / (MOOD_CEIL - MOOD_FLOOR)) * 100));
	const fullnessPct = $derived(
		Math.round(((HUNGER_CEIL - hunger) / (HUNGER_CEIL - HUNGER_FLOOR)) * 100)
	);
</script>

<div class="space-y-3 {className}">
	<div>
		<div
			class="mb-1 flex items-center justify-between text-[11px] font-semibold tracking-wider text-base-content/60 uppercase"
		>
			<span>{m.pet_mood_label()}</span>
			<span class="tabular-nums">{moodPct}%</span>
		</div>
		<div
			class="bar bar--mood"
			role="progressbar"
			aria-label={m.pet_mood_label()}
			aria-valuenow={moodPct}
			aria-valuemin="0"
			aria-valuemax="100"
		>
			<span class="bar__fill" style:width="{moodPct}%"></span>
		</div>
	</div>
	<div>
		<div
			class="mb-1 flex items-center justify-between text-[11px] font-semibold tracking-wider text-base-content/60 uppercase"
		>
			<span>{m.pet_hunger_label()}</span>
			<span class="tabular-nums">{fullnessPct}%</span>
		</div>
		<div
			class="bar bar--hunger"
			role="progressbar"
			aria-label={m.pet_hunger_label()}
			aria-valuenow={fullnessPct}
			aria-valuemin="0"
			aria-valuemax="100"
		>
			<span class="bar__fill" style:width="{fullnessPct}%"></span>
		</div>
	</div>
</div>

<style>
	.bar {
		position: relative;
		height: 10px;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 6%, transparent);
		overflow: hidden;
		border: 1px solid color-mix(in oklab, currentColor 8%, transparent);
	}
	.bar__fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		transition: width 400ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.bar--mood .bar__fill {
		background: linear-gradient(90deg, oklch(78% 0.12 30), oklch(72% 0.14 25));
	}
	.bar--hunger .bar__fill {
		background: linear-gradient(90deg, oklch(82% 0.1 80), oklch(76% 0.12 60));
	}
	@media (prefers-reduced-motion: no-preference) {
		.bar__fill {
			animation: bar-shimmer 2.4s ease-in-out infinite;
		}
	}
	@keyframes bar-shimmer {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.85;
		}
	}
</style>
