<!--
  PillButton — the rounded-full uppercase tracking-wider button used
  across DuoSync. Same idea as Card / SectionHeader: encode the long
  Tailwind chain once so /settings, /onboarding, /repair, /auth and
  friends stay in lockstep.

  Variants:
    - primary       solid bg-primary, the main CTA
    - outline       primary-tinted hairline + bg-base-100, hover bg-primary/10
    - subtle        neutral hairline + bg-base-100, hover bg-base-300
    - danger        error-tinted hairline, hover bg-error/10
    - dangerSolid   solid bg-error (confirm-destructive)
    - ghost         no border, muted text (cancel)

  Sizes:
    - sm  px-3   py-1.5  text-xs       (chips, header tags)
    - md  px-4   py-2.5  text-xs       (default — the workhorse)
    - lg  py-3.5         text-base
          + shadow-paper
          + active:scale-[0.98]        (hero CTA — onboarding, moments/new)

  Props:
    - block       w-full
    - href        renders <a> instead of <button>
    - icon left   passed via children snippet, kept inline-flex centered
    - class       passthrough for one-off overrides

  Width default: inline-flex (so the button sizes to its content). Pass
  `block` for full-width.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'primary' | 'outline' | 'subtle' | 'danger' | 'dangerSolid' | 'ghost';
	type Size = 'sm' | 'md' | 'lg';

	interface Props {
		variant?: Variant;
		size?: Size;
		block?: boolean;
		href?: string;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		onclick?: (event: MouseEvent) => void;
		ariaLabel?: string;
		ariaPressed?: boolean;
		class?: string;
		children: Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		block = false,
		href,
		type = 'button',
		disabled = false,
		onclick,
		ariaLabel,
		ariaPressed,
		class: className = '',
		children
	}: Props = $props();

	const sizeClass = $derived(
		{
			sm: 'px-3 py-1.5 text-xs',
			md: 'px-4 py-2.5 text-xs min-h-11',
			lg: 'py-3.5 text-base shadow-paper transition-transform active:scale-[0.98] min-h-12'
		}[size]
	);

	const variantClass = $derived(
		{
			primary: 'bg-primary text-primary-content',
			outline: 'border border-primary/30 bg-base-100 hover:bg-primary/10',
			subtle: 'border border-base-content/15 bg-base-100 hover:bg-base-300',
			danger: 'border border-error/50 text-error hover:bg-error/10',
			dangerSolid: 'bg-error text-error-content',
			ghost: 'text-base-content/60 hover:text-base-content'
		}[variant]
	);

	const base =
		'inline-flex items-center justify-center gap-1.5 rounded-full font-semibold tracking-wider uppercase transition-opacity disabled:opacity-50';
	const widthClass = $derived(block ? 'w-full' : '');
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- this primitive forwards already-resolved hrefs from callers -->
{#if href}
	<a
		{href}
		class="{base} {variantClass} {sizeClass} {widthClass} {className}"
		aria-label={ariaLabel}
	>
		{@render children()}
	</a>
{:else}
	<button
		{type}
		{disabled}
		{onclick}
		class="{base} {variantClass} {sizeClass} {widthClass} {className}"
		aria-label={ariaLabel}
		aria-pressed={ariaPressed}
	>
		{@render children()}
	</button>
{/if}
