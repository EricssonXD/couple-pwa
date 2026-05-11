<!--
  DuoSync BottomSheet — bits-ui Dialog styled as a bottom drawer.

  Slides up from the safe-area bottom, dims the background with a soft
  paper-shadow scrim, and rounds only the top corners. Used on /map for
  layer toggles and on /moments/new for the composer footer.

  Props:
    open  (bindable boolean) — controls visibility
    title (string, optional) — accessible title; rendered visually too
    contained (boolean, default true) — caps width on tablets

  Slot:
    children — sheet body content
-->
<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		open: boolean;
		title?: string;
		contained?: boolean;
		children: Snippet;
	};

	let { open = $bindable(false), title, contained = true, children }: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay
			class="data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out data-[state=open]:fade-in fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
		/>
		<Dialog.Content
			class="data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom fixed right-0 bottom-0 left-0 z-50 mx-auto max-h-[85dvh] overflow-y-auto rounded-t-[var(--radius-card)] bg-base-100 px-5 pt-4 shadow-paper {contained
				? 'sm:max-w-md'
				: ''}"
			style="padding-bottom: calc(var(--safe-bottom) + 1rem);"
		>
			<!-- Drag handle (visual affordance — bits-ui doesn't ship gesture drag) -->
			<div class="mx-auto mb-3 h-1.5 w-10 rounded-full bg-base-300" aria-hidden="true"></div>

			{#if title}
				<Dialog.Title class="mb-2 text-base font-semibold">{title}</Dialog.Title>
			{:else}
				<Dialog.Title class="sr-only">{m.a11y_bottom_sheet_title()}</Dialog.Title>
			{/if}
			<Dialog.Description class="sr-only">{m.a11y_bottom_sheet_description()}</Dialog.Description>

			{@render children()}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
