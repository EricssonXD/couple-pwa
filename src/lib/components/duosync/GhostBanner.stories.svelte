<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import GhostBanner from './GhostBanner.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/GhostBanner',
		component: GhostBanner,
		tags: ['autodocs']
	});

	const inThirtyMin = new Date(Date.now() + 30 * 60_000).toISOString();
	const inTwoHours = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
</script>

<Story name="ThirtyMin" args={{ ghostUntil: inThirtyMin }} />
<Story name="TwoHours" args={{ ghostUntil: inTwoHours }} />
<Story name="Indefinite" args={{ ghostUntil: null }} />
