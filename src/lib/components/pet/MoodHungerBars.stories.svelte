<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import MoodHungerBars from './MoodHungerBars.svelte';

	const { Story } = defineMeta({
		title: 'Pet/MoodHungerBars',
		component: MoodHungerBars,
		tags: ['autodocs']
	});
</script>

<Story name="Happy" args={{ mood: 88, hunger: 12 }} />
<Story name="Mid" args={{ mood: 55, hunger: 40 }} />
<Story name="Low" args={{ mood: 25, hunger: 75 }} />
