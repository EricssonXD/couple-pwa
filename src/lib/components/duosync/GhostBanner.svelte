<!--
  GhostBanner — shown at top of /pulse when self ghost mode is active.

  Displays a soft slate banner with the ghost icon and a live countdown
  to ghostUntil. Updates every 30 seconds (good enough for minute-grain
  display, cheap on mobile). When ghostUntil is null we show "indefinite".

  An onExit callback lets the parent trigger an "exit ghost mode" mutation
  inline from the banner without a settings detour.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { GhostIcon } from '$lib/components/ui/icons';
	import * as m from '$lib/paraglide/messages.js';

	type Props = {
		ghostUntil?: Date | string | null;
		onExit?: () => void;
	};

	let { ghostUntil = null, onExit }: Props = $props();

	let now = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});

	const untilMs = $derived(ghostUntil ? new Date(ghostUntil as string).getTime() : null);
	const remainingMin = $derived.by(() => {
		if (untilMs == null) return null;
		const ms = Math.max(0, untilMs - now);
		return Math.ceil(ms / 60_000);
	});
	const expired = $derived(remainingMin != null && remainingMin <= 0);

	const label = $derived.by(() => {
		if (untilMs == null) return m.ghost_banner_default();
		if (expired) return m.ghost_banner_ending();
		if (remainingMin! < 60) return m.ghost_banner_remaining_min({ minutes: remainingMin! });
		const h = Math.floor(remainingMin! / 60);
		const mm = remainingMin! % 60;
		return m.ghost_banner_remaining_h({ hours: h, minutesPart: mm ? ` ${mm} 分` : '' });
	});
</script>

<div
	class="flex items-center gap-2 rounded-full border border-base-content/10 bg-base-content/10 px-4 py-2 text-base-content backdrop-blur"
	role="status"
>
	<Icon icon={GhostIcon} size={18} weight="duotone" class="text-base-content/70" />
	<span class="flex-1 text-sm">{label}</span>
	{#if onExit}
		<button
			type="button"
			class="text-xs font-semibold tracking-wider text-primary uppercase hover:underline"
			onclick={onExit}
		>
			{m.ghost_banner_release()}
		</button>
	{/if}
</div>
