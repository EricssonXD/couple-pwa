<!--
  HeartbeatZone stories — U9 baseline.

  This component is interactive (double-tap detection); the stories here
  just exercise the visual states (default hint vs custom hint vs no
  hint vs taller zone). Tap behaviour is covered by the heartbeat
  motion unit tests, not Storybook.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import HeartbeatZone from './HeartbeatZone.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/HeartbeatZone',
		component: HeartbeatZone,
		tags: ['autodocs']
	});
</script>

<Story name="Default" args={{}} />
<Story name="CustomHint" args={{ hint: 'Tap twice to send a heartbeat' }} />
<Story name="NoHint" args={{ hint: null }} />
<Story name="Tall" args={{ height: '10rem' }} />
