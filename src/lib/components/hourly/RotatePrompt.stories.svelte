<!--
	RotatePrompt Storybook — F11 U3.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import RotatePrompt from './RotatePrompt.svelte';

	function noop(): void {}

	const { Story } = defineMeta({
		title: 'F11/RotatePrompt',
		component: RotatePrompt,
		tags: ['autodocs'],
		args: { onlandscape: noop, oncancel: noop }
	});
</script>

<Story name="Default" />

<Story name="No cancel" args={{ onlandscape: noop, oncancel: undefined }} />
