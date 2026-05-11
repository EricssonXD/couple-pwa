<!--
  BottomNav — fixed bottom tab bar.

  Rebuilt from src/lib/components/BottomNav.svelte. Differences:

  - Phosphor duotone icons instead of emoji.
  - Active indicator is a 'breathing path' — a soft rose pill behind
    the icon column that scales/opacity-cycles, instead of just a
    color change. Reduced-motion users still get the color-only signal.
  - 5 tabs (Pulse, Map, Daily, Moments, Settings). 'Daily' surfaces
    the once-per-day couple prompt at /daily.
  - Adds aria-current to the active <a>.

  Visibility: the parent +layout.svelte still owns when to render
  this nav (only for paired logged-in users on app routes). This
  component is a dumb presenter.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/ui/Icon.svelte';
	import {
		PulseIcon,
		MapPinIcon,
		ChatCircleIcon,
		BookOpenIcon,
		GearIcon
	} from '$lib/components/ui/icons';
	import type { IconComponentProps } from 'phosphor-svelte';
	import type { Component } from 'svelte';

	type Tab = {
		href: '/pulse' | '/map' | '/daily' | '/moments' | '/settings';
		label: () => string;
		icon: Component<IconComponentProps>;
	};

	const tabs: Tab[] = [
		{ href: '/pulse', label: m.nav_pulse, icon: PulseIcon },
		{ href: '/map', label: m.nav_map, icon: MapPinIcon },
		{ href: '/daily', label: m.nav_daily, icon: ChatCircleIcon },
		{ href: '/moments', label: m.nav_moments, icon: BookOpenIcon },
		{ href: '/settings', label: m.nav_settings, icon: GearIcon }
	];

	const current = $derived(page.url.pathname);
	function isActive(href: string) {
		if (href === '/settings') return current.startsWith('/settings');
		return current === href || current.startsWith(href + '/');
	}
</script>

<nav
	class="fixed right-0 bottom-0 left-0 z-30 border-t border-base-content/10 bg-base-100/90 backdrop-blur"
	style="padding-bottom: env(safe-area-inset-bottom);"
	aria-label="Primary"
>
	<ul class="mx-auto flex max-w-md justify-around">
		{#each tabs as t (t.href)}
			{@const active = isActive(t.href)}
			<li class="flex-1">
				<a
					href={resolve(t.href)}
					class="relative flex flex-col items-center gap-0.5 py-2 text-[11px] tracking-wide transition-colors {active
						? 'font-semibold text-primary'
						: 'text-base-content/50 hover:text-base-content/80'}"
					aria-current={active ? 'page' : undefined}
				>
					{#if active}
						<span
							class="animate-breathe absolute inset-x-3 top-1 bottom-1 rounded-full bg-primary/12"
							aria-hidden="true"
						></span>
					{/if}
					<span class="relative">
						<Icon icon={t.icon} size={22} weight={active ? 'fill' : 'duotone'} />
					</span>
					<span class="relative">{t.label()}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
