<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import MomentCard from './MomentCard.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/MomentCard',
		component: MomentCard,
		tags: ['autodocs']
	});

	const now = new Date();
</script>

<Story
	name="Unlocked"
	args={{
		locked: false,
		authorIsViewer: false,
		authorName: 'Mira',
		body: '坐在那張長椅上想你. 風是甜的.',
		createdAt: now,
		radiusM: 100
	}}
/>
<Story
	name="LockedClose"
	args={{
		locked: true,
		authorIsViewer: false,
		authorName: 'Mira',
		createdAt: now,
		distanceFromViewerM: 87,
		radiusM: 100
	}}
/>
<Story
	name="LockedFar"
	args={{
		locked: true,
		authorIsViewer: false,
		authorName: 'Mira',
		createdAt: now,
		distanceFromViewerM: 4200,
		radiusM: 100
	}}
/>
<Story
	name="MyOwn"
	args={{
		locked: false,
		authorIsViewer: true,
		authorName: 'You',
		body: '留給她, 等她路過.',
		createdAt: now,
		radiusM: 200
	}}
/>
