<script lang="ts">
	import { page } from '$app/state';

	const tabs = [
		{ href: '/pulse', label: 'Pulse', icon: '💗' },
		{ href: '/moments', label: 'Moments', icon: '📍' },
		{ href: '/daily', label: 'Daily', icon: '✨' },
		{ href: '/settings', label: 'You', icon: '👤' }
	];

	const current = $derived(page.url.pathname);

	function active(href: string) {
		if (href === '/settings') return current.startsWith('/settings');
		return current === href || current.startsWith(href + '/');
	}
</script>

<nav
	class="fixed right-0 bottom-0 left-0 z-30 border-t border-base-300 bg-base-100/95 backdrop-blur"
	style="padding-bottom: env(safe-area-inset-bottom);"
>
	<ul class="mx-auto flex max-w-md justify-around">
		{#each tabs as t (t.href)}
			<li class="flex-1">
				<a
					href={t.href}
					class="flex flex-col items-center gap-0.5 py-2 text-xs transition-colors {active(t.href)
						? 'font-semibold text-primary'
						: 'text-base-content/60'}"
				>
					<span class="text-xl leading-none">{t.icon}</span>
					<span>{t.label}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
