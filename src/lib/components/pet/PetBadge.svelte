<!--
  PetBadge — tiny pet glyph for the /pulse header.

  Same lazy-import strategy as PetSprite, just smaller and without the
  breathing animation (header decoration, not the centerpiece).
  Defaults to `aria-hidden="true"` because the partner-avatar row
  already labels itself; pass `label` if used standalone.
-->
<script lang="ts">
	import { moodKeyFor, type Species, type Stage } from '$lib/pet.constants';

	interface Props {
		species: Species;
		stage: Stage;
		mood: number;
		size?: number;
		label?: string;
		class?: string;
	}

	let { species, stage, mood, size = 32, label, class: className = '' }: Props = $props();

	const moodKey = $derived(moodKeyFor(mood));

	let svgRaw = $state<string>('');
	$effect(() => {
		const sp = species,
			st = stage,
			mk = moodKey;
		let cancelled = false;
		import(`$lib/assets/pet/${sp}/${st}-${mk}.svg?raw`).then((mod: { default: string }) => {
			if (!cancelled) svgRaw = mod.default;
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<span
	class="pet-badge {className}"
	style:--pet-badge-size="{size}px"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	{#if svgRaw}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- raw SVG from our own asset folder -->
		{@html svgRaw}
	{/if}
</span>

<style>
	.pet-badge {
		display: inline-block;
		width: var(--pet-badge-size);
		height: var(--pet-badge-size);
		line-height: 0;
	}
	.pet-badge :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
