<!--
  DuoSync icon convention wrapper.

  Why this exists:
    phosphor-svelte ships ~1500 icons. Importing from the barrel
    (`import { Heart } from 'phosphor-svelte'`) defeats tree-shaking and
    bloats the bundle by ~MBs. The DuoSync convention is per-icon import:

      import HeartIcon from 'phosphor-svelte/lib/HeartIcon';

    This wrapper keeps that tree-shake-friendly pattern while enforcing the
    house style:
      - default `weight="duotone"` (matches Gemini brief's "two-tone outline")
      - default `size={24}` (24px logical, scales with parent font-size when
        size is given as `1em`)
      - `currentColor` so icons inherit text color from DaisyUI theme tokens

  Usage:
    <script>
      import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
      import Icon from '$lib/components/ui/Icon.svelte';
    </script>

    <Icon icon={HeartIcon} />
    <Icon icon={HeartIcon} size={32} weight="fill" class="text-primary" />
-->
<script lang="ts">
	import type { Component } from 'svelte';

	type IconWeight = 'bold' | 'duotone' | 'fill' | 'light' | 'thin' | 'regular';

	type Props = {
		icon: Component<{
			color?: string;
			size?: number | string;
			weight?: IconWeight;
			mirrored?: boolean;
			class?: string;
		}>;
		size?: number | string;
		weight?: IconWeight;
		color?: string;
		mirrored?: boolean;
		class?: string;
		'aria-label'?: string;
	};

	let {
		icon: IconComponent,
		size = 24,
		weight = 'duotone',
		color = 'currentColor',
		mirrored = false,
		class: className = '',
		'aria-label': ariaLabel
	}: Props = $props();
</script>

<span
	class="inline-flex shrink-0 items-center justify-center {className}"
	role={ariaLabel ? 'img' : 'presentation'}
	aria-label={ariaLabel}
	aria-hidden={ariaLabel ? undefined : true}
>
	<IconComponent {size} {weight} {color} {mirrored} />
</span>
