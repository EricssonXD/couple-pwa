<!--
	InputField — paper-dialect text/textarea primitive.

	Encodes the canonical input chain (full-width, rounded radius token,
	hairline border, raised or sunken surface, focus-primary border) that
	repeats across every form in the app.

	Use `rows={n}` to render a <textarea> instead of an <input>. Pass `tone`
	(raised = bg-base-200 over a card, sunken = bg-base-100 inside a card)
	and `size` (md = canonical large, sm = compact /repair-style). All other
	HTMLInput/HTMLTextarea attributes are forwarded via $$restProps.
-->
<script lang="ts">
	import type { HTMLInputAttributes, HTMLTextareaAttributes } from 'svelte/elements';

	type Tone = 'raised' | 'sunken';
	type Size = 'md' | 'sm';

	type Props = {
		value?: string | number;
		tone?: Tone;
		size?: Size;
		rows?: number;
		class?: string;
	} & Omit<HTMLInputAttributes & HTMLTextareaAttributes, 'value' | 'class' | 'size'>;

	let {
		value = $bindable(''),
		tone = 'raised',
		size = 'md',
		rows = 0,
		class: classOverride = '',
		...rest
	}: Props = $props();

	const toneClass = $derived(
		tone === 'raised'
			? 'rounded-[var(--radius-card)] bg-base-200'
			: 'rounded-[var(--radius-field)] bg-base-100'
	);

	const sizeClass = $derived(size === 'md' ? 'px-4 py-3 text-base' : 'px-3.5 py-2.5 text-base');

	const base =
		'w-full border border-base-content/10 outline-none transition-colors focus:border-primary disabled:opacity-50';

	const cls = $derived(`${base} ${toneClass} ${sizeClass} ${classOverride}`);
</script>

{#if rows > 0}
	<textarea bind:value class={`resize-none ${cls}`} {rows} {...rest}></textarea>
{:else}
	<input bind:value class={cls} {...rest} />
{/if}
