<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ShopCard from './ShopCard.svelte';

	const { Story } = defineMeta({
		title: 'Pet/ShopCard',
		component: ShopCard,
		tags: ['autodocs']
	});

	const treat = { id: 'treat_strawberry', name: 'Strawberry treat', price: 8, slot: 'Treat' };
	const hat = { id: 'cosmetic_hat_paper', name: 'Paper crown', price: 60, slot: 'Hat' };
</script>

<Story
	name="Affordable"
	args={{ item: treat, ownedQty: 0, affordable: true, locked: false, onBuy: () => {} }}
/>
<Story
	name="Owned"
	args={{ item: treat, ownedQty: 3, affordable: true, locked: false, onBuy: () => {} }}
/>
<Story
	name="Unaffordable"
	args={{ item: hat, ownedQty: 0, affordable: false, locked: false, onBuy: () => {} }}
/>
<Story
	name="Locked"
	args={{ item: hat, ownedQty: 0, affordable: true, locked: true, onBuy: () => {} }}
/>
