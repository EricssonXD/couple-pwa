<!--
  ChoiceChip — selectable button used in radio-style grids (theme picker,
  language picker, future preference grids). Encodes the rounded-card +
  uppercase + selected-vs-unselected ring/tint chain so settings doesn't
  re-spell it per use site.

  Use inside a `grid` container; component is `block w-full` so each cell
  fills the grid track.

  Selected state: primary-tinted border + bg-primary/10 + primary text.
  Unselected: hairline border + muted text.

  Props:
    - selected  boolean   currently-active state (caller-managed)
    - onclick   () => void
    - icon      optional phosphor icon component, rendered above the label
    - class     passthrough
    - children  label snippet
-->
<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		selected: boolean;
		onclick: () => void;
		icon?: Component;
		class?: string;
		children: Snippet;
	}

	let { selected, onclick, icon, class: className = '', children }: Props = $props();
</script>

<button
	type="button"
	{onclick}
	aria-pressed={selected}
	class="block w-full rounded-[var(--radius-card)] border px-2 py-3 text-xs font-semibold tracking-wider uppercase transition-colors {selected
		? 'border-primary bg-primary/10 text-primary'
		: 'border-base-content/10 text-base-content/60 hover:border-base-content/25'} {className}"
>
	{#if icon}
		<Icon {icon} size={16} weight="duotone" class="mx-auto mb-1" />
	{/if}
	{@render children()}
</button>
