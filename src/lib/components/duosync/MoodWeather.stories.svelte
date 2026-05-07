<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import MoodWeather from './MoodWeather.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/MoodWeather',
		component: MoodWeather,
		tags: ['autodocs']
	});
</script>

<Story name="Sunny" args={{ mood: 'sunny', partnerName: 'Mira' }} />
<Story name="Cloudy" args={{ mood: 'cloudy', partnerName: 'Mira' }} />
<Story name="Rainy" args={{ mood: 'rainy', partnerName: 'Mira' }} />
<Story name="Night" args={{ mood: 'night', partnerName: 'Mira' }} />
