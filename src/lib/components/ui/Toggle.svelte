<!--
  DuoSync Toggle — bits-ui Switch with sage→rose track.

  Used in /settings (ghost mode, notifications). Includes an optional
  inline label so consumers don't need a separate <label> wrapper, and
  a help-text slot for context like "隱身 15 分鐘".
-->
<script lang="ts">
	import { Switch } from 'bits-ui';
	import type { Snippet } from 'svelte';

	type Props = {
		checked: boolean;
		label?: string;
		hint?: string | Snippet;
		disabled?: boolean;
		onchange?: (next: boolean) => void;
	};

	let { checked = $bindable(false), label, hint, disabled = false, onchange }: Props = $props();
</script>

<label class="flex cursor-pointer items-start justify-between gap-4 py-2">
	{#if label || hint}
		<div class="flex flex-col gap-0.5">
			{#if label}<span class="text-sm font-medium">{label}</span>{/if}
			{#if typeof hint === 'string'}
				<span class="text-xs text-base-content/60">{hint}</span>
			{:else if hint}
				{@render hint()}
			{/if}
		</div>
	{/if}

	<Switch.Root
		bind:checked
		{disabled}
		onCheckedChange={(v) => onchange?.(v)}
		class="peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-base-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary"
	>
		<Switch.Thumb
			class="pointer-events-none block h-5 w-5 translate-x-0.5 rounded-full bg-base-100 shadow ring-0 transition-transform data-[state=checked]:translate-x-[1.375rem]"
		/>
	</Switch.Root>
</label>
