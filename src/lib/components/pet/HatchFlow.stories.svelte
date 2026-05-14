<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import HatchFlow from './HatchFlow.svelte';

	const { Story } = defineMeta({
		title: 'Pet/HatchFlow',
		component: HatchFlow,
		tags: ['autodocs']
	});
</script>

<Story name="Default" args={{ submitting: false, error: null, onSubmit: () => {} }} />
<Story name="Submitting" args={{ submitting: true, error: null, onSubmit: () => {} }} />
<Story name="Error" args={{ submitting: false, error: 'Name is too long.', onSubmit: () => {} }} />
