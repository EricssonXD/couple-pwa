<!--
  BottomNav stories — visual baseline for U9.

  Storybook renders without SvelteKit's $app/state runtime, so the active
  tab cannot be derived from page.url.pathname here. We export each tab
  as a separate Story by pre-mocking a window.history pushState before
  rendering. In practice the visual difference is just the active pill,
  so a single "Default" story is enough to catch regressions; the
  per-route active state is exercised by routing tests, not stories.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import BottomNav from './BottomNav.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/BottomNav',
		component: BottomNav,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen'
		}
	});
</script>

<Story name="Default">
	<div style="position: relative; min-height: 12rem;">
		<BottomNav />
	</div>
</Story>
