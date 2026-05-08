<!--
  IosInstallSheet stories — U9 baseline.

  Two modes: Safari (3-step guided flow with inline glyphs) and
  non-Safari (soft prompt to switch). The sheet is bottom-sheet
  modal: stories pin `open: true` so the content renders without a
  trigger.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import IosInstallSheet from './IosInstallSheet.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/IosInstallSheet',
		component: IosInstallSheet,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<Story name="Safari" args={{ open: true, mode: 'safari' }} />
<Story name="NonSafari" args={{ open: true, mode: 'non-safari' }} />
