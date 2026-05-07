<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AnniversaryRibbon from './AnniversaryRibbon.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/AnniversaryRibbon',
		component: AnniversaryRibbon,
		tags: ['autodocs']
	});

	const today = new Date();
	function daysAgo(n: number) {
		const d = new Date(today);
		d.setDate(d.getDate() - n);
		return d.toISOString();
	}
</script>

<Story
	name="EarlyDays"
	args={{ coupleSince: daysAgo(7), anniversary: null, nickname: 'Mira' }}
/>
<Story
	name="OneHundredCountdown"
	args={{ coupleSince: daysAgo(85), anniversary: null, nickname: 'Mira' }}
/>
<Story
	name="NearOneYear"
	args={{ coupleSince: daysAgo(350), anniversary: null, nickname: 'Mira' }}
/>
<Story
	name="WithAnniversary"
	args={{ coupleSince: daysAgo(800), anniversary: daysAgo(800), nickname: 'Mira' }}
/>
