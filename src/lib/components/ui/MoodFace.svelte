<!--
	MoodFace — hand-drawn-feeling SVG mood face.

	Replaces the 😄😊😐😔😢 emoji set across MoodPicker, MoodTrendStrip and
	the pulse partner badge. Stroke-based SVG inherits currentColor so each
	caller can tint via parent text-* classes; the default tint mapping
	below is what /pulse + /settings use.

	Faces are intentionally slightly asymmetric (eye spacing, mouth offset)
	so they don't read as machine-perfect — that's the "non-AI-generated"
	feel the design audit calls for.
-->
<script lang="ts">
	import type { Mood } from '$lib/server/services/mood';

	type Props = {
		mood: Mood;
		size?: number;
		class?: string;
		'aria-label'?: string;
		tinted?: boolean;
	};

	let {
		mood,
		size = 32,
		class: className = '',
		'aria-label': ariaLabel,
		tinted = true
	}: Props = $props();

	const TINT: Record<Mood, string> = {
		joyful: 'text-warning',
		happy: 'text-success',
		neutral: 'text-base-content/60',
		sad: 'text-info',
		upset: 'text-error'
	};

	const tintClass = $derived(tinted ? TINT[mood] : '');
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 32 32"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={`${tintClass} ${className}`}
	role={ariaLabel ? 'img' : 'presentation'}
	aria-label={ariaLabel}
	aria-hidden={ariaLabel ? undefined : true}
>
	<!-- face circle: ever so slightly off-round to feel hand-drawn -->
	<path d="M16 3.4c6.9 0 12.6 5.7 12.6 12.6S22.9 28.7 16 28.7 3.4 23 3.4 16.1 9.1 3.4 16 3.4Z" />

	{#if mood === 'joyful'}
		<!-- happy closed eyes (curves) + wide open smile -->
		<path d="M9.6 13.4c.7-.9 1.7-1.4 2.6-1.4s2 .5 2.7 1.4" />
		<path d="M17.7 13.4c.7-.9 1.7-1.4 2.6-1.4s2 .5 2.7 1.4" />
		<path d="M9.4 18.6c1.4 2.4 4 3.8 6.7 3.8 2.7 0 5.3-1.4 6.6-3.8" stroke-width="2" />
	{:else if mood === 'happy'}
		<!-- dot eyes + gentle smile -->
		<circle cx="11.7" cy="13.6" r="1.05" fill="currentColor" stroke="none" />
		<circle cx="20.4" cy="13.4" r="1.05" fill="currentColor" stroke="none" />
		<path d="M10.8 18.6c1.5 1.6 3.3 2.4 5.2 2.4s3.7-.8 5.1-2.4" />
	{:else if mood === 'neutral'}
		<!-- dot eyes + flat-ish line mouth -->
		<circle cx="11.7" cy="13.6" r="1" fill="currentColor" stroke="none" />
		<circle cx="20.4" cy="13.4" r="1" fill="currentColor" stroke="none" />
		<path d="M10.8 19.5c1.7-.2 3.4-.3 5.2-.3s3.5.1 5.2.3" />
	{:else if mood === 'sad'}
		<!-- dot eyes + downward curve mouth -->
		<circle cx="11.6" cy="13.6" r="1" fill="currentColor" stroke="none" />
		<circle cx="20.4" cy="13.5" r="1" fill="currentColor" stroke="none" />
		<path d="M10.6 21c1.5-1.7 3.3-2.5 5.3-2.5s3.7.8 5.2 2.5" />
	{:else if mood === 'upset'}
		<!-- worried brows + dot eyes + deeper downward mouth -->
		<path d="M9 12c1-.5 2.1-.4 3.2.2" />
		<path d="M19.7 12.2c1.1-.6 2.2-.7 3.2-.2" />
		<circle cx="12" cy="14.4" r="1" fill="currentColor" stroke="none" />
		<circle cx="20" cy="14.4" r="1" fill="currentColor" stroke="none" />
		<path d="M10.4 21.7c1.6-2 3.4-3 5.5-3s3.9 1 5.5 3" stroke-width="2" />
	{/if}
</svg>
