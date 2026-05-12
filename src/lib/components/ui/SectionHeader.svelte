<!--
  SectionHeader — the small "icon + uppercase tracking-wider micro
  label" header used across paper-dialect cards in /settings, /pulse
  surrounds, etc. Centralised so future tweaks (letter-spacing,
  weight, icon weight) stay in one place.

  `icon` is a Phosphor component reference; we wrap in our own Icon
  shim so weight + a11y stay consistent.
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		title: string;
		icon?: Component;
		tone?: 'primary' | 'secondary' | 'accent' | 'muted';
		class?: string;
	}

	let { title, icon, tone = 'primary', class: className = '' }: Props = $props();

	const iconColor = {
		primary: 'text-primary',
		secondary: 'text-secondary',
		accent: 'text-accent',
		muted: 'text-base-content/70'
	}[tone];
</script>

<header class="flex items-center gap-2 {className}">
	{#if icon}
		<Icon icon={icon} size={18} weight="duotone" class={iconColor} />
	{/if}
	<h2 class="text-sm font-semibold tracking-wider uppercase">{title}</h2>
</header>
