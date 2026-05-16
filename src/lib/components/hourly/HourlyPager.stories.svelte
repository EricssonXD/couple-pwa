<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import HourlyPager from './HourlyPager.svelte';
	import { currentBucket, prevHour } from '$lib/hourly/dayNav';

	const { Story } = defineMeta({
		title: 'Hourly/HourlyPager',
		component: HourlyPager,
		parameters: { layout: 'fullscreen' }
	});

	const now = currentBucket();
	const prev = prevHour(now);

	const sampleClip = {
		id: 'demo',
		mime: 'video/webm',
		playbackUrl:
			'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4'
	};
</script>

<Story
	name="Current — both captured"
	args={{
		selectedBucket: now,
		youCells: { [now]: { hourBucket: now, clip: sampleClip, mood: 'happy' } },
		partnerCells: { [now]: { hourBucket: now, clip: sampleClip, mood: 'joyful' } }
	}}
/>

<Story
	name="Current — you empty"
	args={{
		selectedBucket: now,
		youCells: {},
		partnerCells: { [now]: { hourBucket: now, clip: sampleClip, mood: 'neutral' } }
	}}
/>

<Story
	name="Past hour — both skipped"
	args={{
		selectedBucket: prev,
		youCells: {},
		partnerCells: {}
	}}
/>
