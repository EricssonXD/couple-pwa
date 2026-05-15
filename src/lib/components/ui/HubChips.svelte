<!--
  HubChips — horizontal scroll-snap chip row for hub sub-navigation.

  Used at the top of hub pages (/daily, /moments, /settings) to expose
  child routes that share the same BottomNav tab. See docs/ui-design.md
  §7.1 (HubChips contract) and §8 (information architecture).

  Behaviour:
  - Each chip is a real `<a>` (NOT a JS-onclick button) so middle-click,
    long-press preview, and prefetch all work.
  - Active chip gets `bg-primary/12` + filled icon + `aria-current="page"`.
  - Row scrolls horizontally with scroll-snap; no JS scroll animation
    (reduced-motion safe by construction).
  - Tap targets are ≥44px tall per a11y §10.2.

  Props:
    chips    Array<{ href, label, icon?, exact? }>
             href     route to link to (passed through `resolve()`)
             label    () => string  paraglide message function
             icon     optional Phosphor component (rendered 16px before label)
             exact    if true, only highlight on exact href match
                      (default false → also lit for /href/* sub-routes)
    current  string  active route — typically `page.url.pathname`
    class    string  passthrough on the <nav>

  This is a primitive — wrap it inside a duosync/HubHeader (see §7.2)
  unless you have a strong reason to use it standalone.
-->
<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { IconComponentProps } from 'phosphor-svelte';
	import type { Component } from 'svelte';

	type Chip = {
		/** Already-resolved href (caller invokes `resolve()` for type safety on its end). */
		href: string;
		label: () => string;
		icon?: Component<IconComponentProps>;
		exact?: boolean;
	};

	type Props = {
		chips: Chip[];
		current: string;
		class?: string;
	};

	let { chips, current, class: klass = '' }: Props = $props();

	function isActive(c: Chip): boolean {
		if (c.exact) return current === c.href;
		return current === c.href || current.startsWith(c.href + '/');
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- chips arrive already-resolved from caller -->
<nav
	aria-label="Section navigation"
	class="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden {klass}"
>
	{#each chips as chip (chip.href)}
		{@const active = isActive(chip)}
		<a
			href={chip.href}
			aria-current={active ? 'page' : undefined}
			class="inline-flex min-h-[44px] shrink-0 snap-start items-center gap-1.5 rounded-selector px-4 text-sm font-medium transition-colors {active
				? 'bg-primary/12 text-base-content'
				: 'bg-base-200 text-base-content/70 hover:bg-base-200/70'}"
		>
			{#if chip.icon}
				<Icon icon={chip.icon} size={16} weight={active ? 'fill' : 'duotone'} />
			{/if}
			{chip.label()}
		</a>
	{/each}
</nav>
