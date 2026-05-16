<!--
	RotatePrompt Storybook — F11 U3.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import RotatePrompt from './RotatePrompt.svelte';

	const { Story } = defineMeta({
		title: 'F11/RotatePrompt',
		component: RotatePrompt,
		tags: ['autodocs']
	});
</script>

<script lang="ts">
	function noop(): void {}
</script>

<Story name="Default">
	<RotatePrompt onlandscape={noop} oncancel={noop} />
</Story>

<Story name="No cancel">
	<RotatePrompt onlandscape={noop} />
</Story>
