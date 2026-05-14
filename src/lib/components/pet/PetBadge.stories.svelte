<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PetBadge from './PetBadge.svelte';

	const { Story } = defineMeta({
		title: 'Pet/PetBadge',
		component: PetBadge,
		tags: ['autodocs']
	});
</script>

<Story name="Happy" args={{ species: 'fox', stage: 'baby', mood: 85 }} />
<Story name="Neutral" args={{ species: 'cat', stage: 'baby', mood: 55 }} />
<Story name="Sad" args={{ species: 'capybara', stage: 'grown', mood: 25 }} />
<Story
	name="Labelled"
	args={{ species: 'bird', stage: 'egg', mood: 80, label: 'Bird egg, happy' }}
/>
