<!--
  DistanceBubble stories — visual baseline for U9.
  One story per bucket + ghost variant. Renders inside layout.css
  tokens (storybook preview imports it).
-->
<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DistanceBubble from './DistanceBubble.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/DistanceBubble',
		component: DistanceBubble,
		tags: ['autodocs']
	});
</script>

<Story name="Together" args={{ distanceM: 8, bucket: 'together' }} />
<Story name="Near" args={{ distanceM: 240, bucket: 'near' }} />
<Story name="SameCity" args={{ distanceM: 4200, bucket: 'same_city' }} />
<Story name="Far" args={{ distanceM: 9000000, bucket: 'far' }} />
<Story name="Unknown" args={{ distanceM: null, bucket: 'unknown' }} />
<Story name="Ghost" args={{ distanceM: 240, bucket: 'near', ghost: true }} />
