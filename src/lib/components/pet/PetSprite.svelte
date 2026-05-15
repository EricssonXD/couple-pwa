<!--
  PetSprite — renders the right (species, stage, mood) sprite with a
  gentle 4 s breathing animation.

  Bundle strategy: lazy-imports `*.svg?raw` for the active species so
  only that species' 9 frames enter the /pet chunk. Other species are
  never fetched.

  Accessibility: `role="img"` + i18n-driven `aria-label`. The breathing
  animation only runs under `prefers-reduced-motion: no-preference`.

  Props:
    - species  Species
    - stage    Stage
    - mood     numeric mood (MOOD_FLOOR..MOOD_CEIL); bucketed via moodKeyFor
    - size     px (default 96)
    - label    optional explicit a11y label
    - class    passthrough
-->
<script lang="ts">
	import { moodKeyFor, STAGES, type Species, type Stage } from '$lib/pet.constants';

	interface Props {
		species: Species;
		stage: Stage;
		mood: number;
		size?: number;
		label?: string;
		class?: string;
	}

	let { species, stage, mood, size = 96, label, class: className = '' }: Props = $props();

	const moodKey = $derived(moodKeyFor(mood));
	const ariaLabel = $derived(label ?? `${species} ${stage}`);

	let svgRaw = $state<string>('');
	let loadError = $state(false);

	$effect(() => {
		const sp = species;
		const st = stage;
		const mk = moodKey;
		let cancelled = false;
		loadError = false;
		import(`$lib/assets/pet/${sp}/${st}-${mk}.svg?raw`)
			.then((mod: { default: string }) => {
				if (!cancelled) svgRaw = mod.default;
			})
			.catch(() => {
				if (!cancelled) loadError = true;
			});
		return () => {
			cancelled = true;
		};
	});

	// One-shot stage-up animation. Tracks the previously rendered stage
	// and fires `playStageUp` for one animation cycle when the pet
	// progresses forward (egg → baby → grown). Reduced motion is handled
	// in CSS — the class applies but the keyframes resolve to identity.
	let prevStage = $state<Stage | null>(null);
	let playStageUp = $state(false);
	let stageUpTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const current = stage;
		const prev = prevStage;
		prevStage = current;
		if (prev === null || prev === current) return;
		const prevIdx = STAGES.indexOf(prev);
		const currIdx = STAGES.indexOf(current);
		if (currIdx <= prevIdx) return; // never animate regressions
		playStageUp = true;
		if (stageUpTimer) clearTimeout(stageUpTimer);
		stageUpTimer = setTimeout(() => {
			playStageUp = false;
			stageUpTimer = null;
		}, 900);
		return () => {
			if (stageUpTimer) {
				clearTimeout(stageUpTimer);
				stageUpTimer = null;
			}
		};
	});
</script>

<span
	class="pet-sprite {className}"
	class:pet-sprite--stageup={playStageUp}
	style:--pet-size="{size}px"
	role="img"
	aria-label={ariaLabel}
>
	{#if loadError}
		<span class="pet-sprite__fallback" aria-hidden="true">·</span>
	{:else if svgRaw}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- raw SVG built at compile time from our own asset folder -->
		{@html svgRaw}
	{:else}
		<span class="pet-sprite__skeleton" aria-hidden="true"></span>
	{/if}
</span>

<style>
	.pet-sprite {
		display: inline-block;
		width: var(--pet-size);
		height: var(--pet-size);
		line-height: 0;
	}
	.pet-sprite :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
	.pet-sprite__skeleton {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: 16%;
		background: color-mix(in oklab, currentColor 6%, transparent);
	}
	.pet-sprite__fallback {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		font-size: calc(var(--pet-size) * 0.6);
		color: color-mix(in oklab, currentColor 30%, transparent);
	}
	@media (prefers-reduced-motion: no-preference) {
		.pet-sprite :global(svg) {
			transform-origin: 50% 80%;
			animation: pet-breathe 4s ease-in-out infinite;
		}
		.pet-sprite--stageup :global(svg) {
			animation:
				pet-stageup 900ms cubic-bezier(0.2, 0.7, 0.2, 1) 1,
				pet-breathe 4s ease-in-out infinite 900ms;
		}
	}
	@keyframes pet-breathe {
		0%,
		100% {
			transform: scaleY(1);
		}
		50% {
			transform: scaleY(1.02);
		}
	}
	@keyframes pet-stageup {
		0% {
			transform: perspective(420px) rotateX(0deg) scale(1);
			filter: brightness(1);
		}
		35% {
			transform: perspective(420px) rotateX(-78deg) scale(0.9);
			filter: brightness(1.25);
		}
		60% {
			transform: perspective(420px) rotateX(18deg) scale(1.08);
			filter: brightness(1.15);
		}
		100% {
			transform: perspective(420px) rotateX(0deg) scale(1);
			filter: brightness(1);
		}
	}
</style>
