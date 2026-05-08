<!--
  Slider stories — U9 baseline.

  Single-thumb DuoSync slider used in /moments/new (radius) and
  /settings (ghost duration). Covers default state, label only, label
  with formatValue, custom range, and an extreme step.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Slider from './Slider.svelte';

	const { Story } = defineMeta({
		title: 'UI/Slider',
		component: Slider,
		tags: ['autodocs']
	});
</script>

<Story name="Default" args={{ value: [50] }} />
<Story name="WithLabel" args={{ value: [30], label: 'Volume' }} />
<Story
	name="RadiusMeters"
	args={{
		value: [100],
		min: 30,
		max: 500,
		step: 10,
		label: 'Radius',
		formatValue: (v: number) => `${v} m`
	}}
/>
<Story
	name="GhostMinutes"
	args={{
		value: [15],
		min: 5,
		max: 120,
		step: 5,
		label: 'Ghost duration',
		formatValue: (v: number) => `${v} min`
	}}
/>
<Story name="AtMin" args={{ value: [0], min: 0, max: 100 }} />
<Story name="AtMax" args={{ value: [100], min: 0, max: 100 }} />
