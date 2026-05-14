<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PetSprite from './PetSprite.svelte';

	const { Story } = defineMeta({
		title: 'Pet/PetSprite',
		component: PetSprite,
		tags: ['autodocs']
	});
</script>

<Story name="FoxBabyHappy" args={{ species: 'fox', stage: 'baby', mood: 88, size: 96 }} />
<Story name="FoxBabyNeutral" args={{ species: 'fox', stage: 'baby', mood: 55, size: 96 }} />
<Story name="FoxBabySad" args={{ species: 'fox', stage: 'baby', mood: 28, size: 96 }} />
<Story name="CatGrownHappy" args={{ species: 'cat', stage: 'grown', mood: 92, size: 128 }} />
<Story name="BirdEgg" args={{ species: 'bird', stage: 'egg', mood: 72, size: 96 }} />
<Story
	name="CapybaraGrownSad"
	args={{ species: 'capybara', stage: 'grown', mood: 24, size: 128 }}
/>
