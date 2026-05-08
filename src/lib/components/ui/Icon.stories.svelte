<!--
  Icon stories — U9 baseline.

  Wraps phosphor-svelte icons. Stories cover the default duotone weight,
  alternative weights, sizes, and an aria-labelled (accessible) variant.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Icon from './Icon.svelte';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import StarIcon from 'phosphor-svelte/lib/StarIcon';
	import MapPinIcon from 'phosphor-svelte/lib/MapPinIcon';

	const { Story } = defineMeta({
		title: 'UI/Icon',
		component: Icon,
		tags: ['autodocs']
	});
</script>

<Story name="DefaultDuotone" args={{ icon: HeartIcon }} />
<Story name="WeightFill" args={{ icon: HeartIcon, weight: 'fill' }} />
<Story name="WeightBold" args={{ icon: StarIcon, weight: 'bold' }} />
<Story name="WeightThin" args={{ icon: StarIcon, weight: 'thin' }} />
<Story name="Large" args={{ icon: MapPinIcon, size: 64 }} />
<Story name="WithAriaLabel" args={{ icon: HeartIcon, 'aria-label': 'Favorite', size: 32 }} />
