<!--
	HourTile Storybook — F11 redesign U2.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import HourTile from './HourTile.svelte';

	const { Story } = defineMeta({
		title: 'F11/HourTile',
		component: HourTile,
		tags: ['autodocs']
	});

	const SAMPLE_VIDEO = 'https://www.w3schools.com/html/mov_bbb.mp4';
</script>

<script lang="ts">
	function noop(): void {}
</script>

<Story name="You — current hour, empty (capture affordance)">
	<div class="max-w-md p-6">
		<HourTile owner="you" isCurrentHour={true} clip={null} mood={null} oncapture={noop} />
	</div>
</Story>

<Story name="You — current hour, captured + mood">
	<div class="max-w-md p-6">
		<HourTile
			owner="you"
			isCurrentHour={true}
			clip={{ id: '1', mime: 'video/mp4', playbackUrl: SAMPLE_VIDEO }}
			mood="joyful"
			ontap={noop}
		/>
	</div>
</Story>

<Story name="You — past hour, skipped">
	<div class="max-w-md p-6">
		<HourTile owner="you" isCurrentHour={false} clip={null} mood={null} />
	</div>
</Story>

<Story name="You — past hour, captured">
	<div class="max-w-md p-6">
		<HourTile
			owner="you"
			isCurrentHour={false}
			clip={{ id: '2', mime: 'video/mp4', playbackUrl: SAMPLE_VIDEO }}
			mood="happy"
			ontap={noop}
		/>
	</div>
</Story>

<Story name="Partner — current hour, waiting">
	<div class="max-w-md p-6">
		<HourTile owner="partner" isCurrentHour={true} clip={null} mood={null} />
	</div>
</Story>

<Story name="Partner — past hour, captured">
	<div class="max-w-md p-6">
		<HourTile
			owner="partner"
			isCurrentHour={false}
			clip={{ id: '3', mime: 'video/mp4', playbackUrl: SAMPLE_VIDEO }}
			mood="neutral"
			ontap={noop}
		/>
	</div>
</Story>

<Story name="Stacked pair (you + partner)">
	<div class="flex max-w-md flex-col gap-3 p-6">
		<HourTile
			owner="you"
			isCurrentHour={true}
			clip={{ id: '1', mime: 'video/mp4', playbackUrl: SAMPLE_VIDEO }}
			mood="happy"
			ontap={noop}
		/>
		<HourTile owner="partner" isCurrentHour={true} clip={null} mood={null} />
	</div>
</Story>
