<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import CoinIcon from './CoinIcon.svelte';

	const { Story } = defineMeta({
		title: 'Pet/CoinIcon',
		component: CoinIcon,
		tags: ['autodocs']
	});
</script>

<Story name="Default" args={{ size: 16 }} />
<Story name="Inline" args={{ size: 14 }} />
<Story name="Large" args={{ size: 32 }} />
