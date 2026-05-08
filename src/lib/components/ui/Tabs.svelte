<!--
  DuoSync Tabs — bits-ui Tabs with rose underline indicator.

  Used in /settings to group profile / notifications / couple sections,
  and in /map's bottom-sheet to switch between layers / pins / settings.

  Props:
    value (bindable string) — active tab id
    items: Array<{ id, label, content }> — declarative tab list

  For more bespoke layouts the consumer can compose <Tabs.Root> directly
  from bits-ui; this wrapper is the convenience case.
-->
<script lang="ts">
	import { Tabs } from 'bits-ui';
	import type { Snippet } from 'svelte';

	type TabItem = {
		id: string;
		label: string;
		content: Snippet;
	};

	type Props = {
		value: string;
		items: TabItem[];
		class?: string;
	};

	let { value = $bindable(''), items, class: className = '' }: Props = $props();
</script>

<Tabs.Root bind:value class={className}>
	<Tabs.List class="flex w-full gap-1 border-b border-base-300" role="tablist">
		{#each items as item (item.id)}
			<Tabs.Trigger
				value={item.id}
				class="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-base-content/60 transition-colors data-[state=active]:border-primary data-[state=active]:text-primary"
			>
				{item.label}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>

	{#each items as item (item.id)}
		<Tabs.Content value={item.id} class="pt-4">
			{@render item.content()}
		</Tabs.Content>
	{/each}
</Tabs.Root>
