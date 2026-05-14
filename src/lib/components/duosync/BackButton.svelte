<!--
  BackButton — small arrow-left button used at the top of secondary
  routes (timeline, chat, bucket, calendar, notes, quiz, repair, …)
  to give the user a way out without forcing them to rely on the
  BottomNav alone.

  Behaviour:
  - Pops the in-tab history when there's somewhere to pop back to,
    falling back to `fallbackHref` (default `/pulse`) so deep-link /
    cold-launch / standalone-PWA opens still go somewhere sensible.
  - "Has history" is tracked via afterNavigate (records every client
    nav as it happens) instead of `window.history.length`, which lies
    on iOS standalone PWAs (always reports 1 even after navigations).
  - aria-label defaults to a generic "Back"; override per-page if a
    more specific destination is meaningful.

  Visual: 36px circle, ghost on idle, base-200 hover. Designed to sit
  flush-left at the top of a route's <main>, just above its existing
  page header.
-->
<script lang="ts">
	import { goto, afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import * as m from '$lib/paraglide/messages.js';

	type Props = {
		/** Where to go if the user lands here cold (no in-tab history). */
		fallbackHref?: '/pulse' | '/map' | '/daily' | '/moments' | '/settings';
		/** Override the default "Back" aria-label for screen readers. */
		ariaLabel?: string;
		/** Optional extra classes on the wrapper button. */
		class?: string;
	};

	const { fallbackHref = '/pulse', ariaLabel, class: klass = '' }: Props = $props();

	let canPop = $state(false);
	afterNavigate((nav) => {
		if (nav.from) canPop = true;
	});

	function back() {
		if (canPop) {
			history.back();
		} else {
			goto(resolve(fallbackHref), { replaceState: true });
		}
	}
</script>

<button
	type="button"
	onclick={back}
	aria-label={ariaLabel ?? m.page_header_back_aria()}
	class="inline-flex h-9 w-9 items-center justify-center rounded-full text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content {klass}"
>
	<Icon icon={ArrowLeftIcon} size={18} weight="bold" />
</button>
