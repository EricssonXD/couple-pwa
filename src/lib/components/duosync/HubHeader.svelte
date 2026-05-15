<!--
  HubHeader — top-of-page header for hub routes (/daily, /moments, …).

  Composes BackButton (for safety on deep-link / cold-launch) + a
  page title + a HubChips row exposing the hub's child routes. See
  docs/ui-design.md §7.1 (HubChips contract) and §8 (IA table).

  This is the duosync-flavoured wrapper; the bare HubChips primitive
  lives at $lib/components/ui/HubChips.svelte.

  Props:
    title         () => string  paraglide title for the hub
    fallbackHref  destination for the BackButton when no history exists
                  (defaults to /pulse — the home tab)
    chips         passed straight through to HubChips
    current       active path — typically `page.url.pathname`
    class         passthrough on wrapper

  Layout: title row sits inside a `pt-6 pb-2 px-4` block; HubChips row
  follows underneath. The chip row's own `-mx-4` lets it bleed to the
  viewport edge so users feel they can flick freely.
-->
<script lang="ts">
	import BackButton from './BackButton.svelte';
	import HubChips from '$lib/components/ui/HubChips.svelte';

	type Chip = {
		href: string;
		label: () => string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		icon?: any;
		exact?: boolean;
	};

	type Props = {
		title: () => string;
		fallbackHref?: '/pulse' | '/map' | '/daily' | '/moments' | '/settings';
		chips: Chip[];
		current: string;
		class?: string;
	};

	const { title, fallbackHref = '/pulse', chips, current, class: klass = '' }: Props = $props();
</script>

<header class="px-4 pt-6 pb-2 {klass}">
	<div class="mb-2 flex items-center gap-2">
		<BackButton {fallbackHref} class="-ml-2" />
		<h1 class="text-xl font-semibold text-base-content">{title()}</h1>
	</div>
	<HubChips {chips} {current} />
</header>
