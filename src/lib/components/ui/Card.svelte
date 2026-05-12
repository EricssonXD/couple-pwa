<!--
  Card — paper-dialect surface. Wraps content in the bespoke
  `bg-base-200` + `shadow-paper` + soft hairline + var(--radius-card)
  combination used across /pulse, /settings, /onboarding/link. Use
  this instead of repeating the long Tailwind chain so the look stays
  in lockstep across pages.

  Variants:
    - tone='default' (cream paper, the signature look)
    - tone='danger'  (error-tinted, used for destructive sections in
      /settings — bg-error/5, border-error/30, no shadow)

  Props match Svelte 5 idiom: `children` snippet + `class` passthrough
  for one-off overrides. `padding` lets dense pages opt out.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	type Tone = 'default' | 'danger';
	type Padding = 'sm' | 'md' | 'lg' | 'none';

	interface Props {
		tone?: Tone;
		padding?: Padding;
		class?: string;
		children: Snippet;
	}

	let { tone = 'default', padding = 'md', class: className = '', children }: Props = $props();

	const padClass = $derived(
		{
			none: '',
			sm: 'p-4',
			md: 'p-5',
			lg: 'p-6'
		}[padding]
	);

	const toneClass = $derived(
		tone === 'danger'
			? 'border-error/30 bg-error/5'
			: 'border-base-content/5 bg-base-200 shadow-paper'
	);
</script>

<section
	class="rounded-[var(--radius-card)] border {toneClass} {padClass} {className}"
>
	{@render children()}
</section>
