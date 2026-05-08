<!--
  BottomSheet stories — U9 baseline.

  bits-ui Dialog as a bottom drawer. Stories pin `open: true` so the
  sheet renders without a trigger; the `children` slot carries simple
  demo content.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import BottomSheet from './BottomSheet.svelte';

	const { Story } = defineMeta({
		title: 'UI/BottomSheet',
		component: BottomSheet,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<Story name="WithTitle">
	<BottomSheet open={true} title="Filter moments">
		<p class="text-sm">Pick a date range to filter moments by.</p>
		<div class="mt-4 flex justify-end gap-2">
			<button class="btn btn-ghost btn-sm">Cancel</button>
			<button class="btn btn-primary btn-sm">Apply</button>
		</div>
	</BottomSheet>
</Story>

<Story name="NoTitle">
	<BottomSheet open={true}>
		<p class="text-sm">Untitled bottom sheet — uses sr-only fallback title.</p>
	</BottomSheet>
</Story>

<Story name="Uncontained">
	<BottomSheet open={true} title="Full width" contained={false}>
		<p class="text-sm">contained={'{false}'} — no max-width on tablets.</p>
	</BottomSheet>
</Story>

<Story name="LongContent">
	<BottomSheet open={true} title="Scrollable">
		<div class="space-y-3">
			{#each Array(20) as _, i}
				<p class="text-sm">Row {i + 1} — long content scrolls within the sheet.</p>
			{/each}
		</div>
	</BottomSheet>
</Story>
