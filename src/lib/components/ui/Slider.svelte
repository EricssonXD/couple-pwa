<!--
  DuoSync Slider — bits-ui Slider with rose track + sage range fill.

  Single-thumb only (multi-thumb not needed for current screens). Used
  in /moments/new for radius selection (30 / 100 / 500 m) and in
  /settings for ghost-mode duration.

  Props:
    value (bindable number[]) — array because bits-ui Slider is multi-
      capable; for single-thumb pass [n].
    min, max, step — usual semantics
    label (string, optional) — visible label above the track
    formatValue (fn, optional) — render the live value badge above thumb
-->
<script lang="ts">
	import { Slider as B } from 'bits-ui';

	type Props = {
		value: number[];
		min?: number;
		max?: number;
		step?: number;
		label?: string;
		formatValue?: (v: number) => string;
		class?: string;
	};

	let {
		value = $bindable([0]),
		min = 0,
		max = 100,
		step = 1,
		label,
		formatValue,
		class: className = ''
	}: Props = $props();

	const display = $derived(formatValue ? formatValue(value[0]) : String(value[0]));
</script>

<div class="flex flex-col gap-2 {className}">
	{#if label}
		<div class="flex items-baseline justify-between text-sm">
			<span class="text-base-content/70">{label}</span>
			<span class="text-display text-base font-semibold">{display}</span>
		</div>
	{/if}

	<B.Root
		type="single"
		bind:value={
			() => value[0] ?? min,
			(v) => {
				value = [v];
			}
		}
		{min}
		{max}
		{step}
		class="relative flex h-5 w-full touch-none items-center select-none"
	>
		<span class="bg-base-300 relative h-1.5 w-full grow overflow-hidden rounded-full">
			<B.Range class="bg-secondary absolute h-full" />
		</span>
		<B.Thumb
			index={0}
			class="border-primary bg-base-100 ring-primary/20 hover:ring-primary/40 block h-5 w-5 cursor-grab rounded-full border-2 shadow-paper transition-shadow focus-visible:ring-4 focus-visible:outline-none active:cursor-grabbing"
		/>
	</B.Root>
</div>
