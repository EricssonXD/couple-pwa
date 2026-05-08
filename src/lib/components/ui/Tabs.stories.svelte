<!--
  Tabs stories — U9 baseline.

  Wrapper around bits-ui Tabs. items[].content is a Snippet, so we
  declare the snippets in the module/component scope and pass them in
  via the items array.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Tabs from './Tabs.svelte';

	const { Story } = defineMeta({
		title: 'UI/Tabs',
		component: Tabs,
		tags: ['autodocs']
	});
</script>

{#snippet profile()}
	<p class="text-sm">Profile tab content — name, avatar, bio.</p>
{/snippet}
{#snippet notifications()}
	<p class="text-sm">Notifications tab content — push + email toggles.</p>
{/snippet}
{#snippet couple()}
	<p class="text-sm">Couple tab content — partner pairing + ghost mode.</p>
{/snippet}
{#snippet layers()}
	<p class="text-sm">Map layers — terrain, satellite, history trail.</p>
{/snippet}
{#snippet pins()}
	<p class="text-sm">Saved pins list — favourite locations.</p>
{/snippet}

<Story name="ThreeTabs">
	<Tabs
		value="profile"
		items={[
			{ id: 'profile', label: 'Profile', content: profile },
			{ id: 'notifications', label: 'Notifications', content: notifications },
			{ id: 'couple', label: 'Couple', content: couple }
		]}
	/>
</Story>

<Story name="TwoTabs">
	<Tabs
		value="layers"
		items={[
			{ id: 'layers', label: 'Layers', content: layers },
			{ id: 'pins', label: 'Pins', content: pins }
		]}
	/>
</Story>
