<!--
  HeartbeatZone — invisible double-tap surface at the bottom of /pulse.

  Listens for two pointerdowns within 350ms (via createHeartbeat from
  $lib/motion). On detection: spawns a visual ripple at the second tap
  point + plays the heartbeat haptic + invokes onTap so the parent can
  POST /api/realtime/tap.

  The zone has a faint waveform glyph at its top edge so users discover
  the affordance without copy. Hint label appears on first 5 seconds.

  Props:
    onTap     callback fired per double-tap
    height    css value for the zone height; default '6rem'
    hint      string shown faintly when idle; null to hide
-->
<script lang="ts">
	import { createHeartbeat } from '$lib/motion/heartbeat.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { WaveformIcon } from '$lib/components/ui/icons';
	import * as m from '$lib/paraglide/messages.js';

	type Props = {
		onTap?: () => void;
		height?: string;
		hint?: string | null;
	};

	let { onTap, height = '6rem', hint }: Props = $props();
	const resolvedHint = $derived(hint === null ? null : (hint ?? m.heartbeat_zone_hint()));

	const heartbeat = createHeartbeat({ onTap: () => onTap?.() });
</script>

<div
	class="relative w-full select-none"
	style="height: {height};"
	use:heartbeat.action
	role="button"
	tabindex="0"
	aria-label="Send heartbeat to partner — double tap"
>
	<!-- top affordance glyph -->
	<div
		class="pointer-events-none absolute inset-x-0 top-1 grid place-items-center text-base-content/30"
	>
		<Icon icon={WaveformIcon} size={20} weight="duotone" />
	</div>

	{#if resolvedHint}
		<p
			class="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] tracking-wider text-base-content/40"
		>
			{resolvedHint}
		</p>
	{/if}

	<!-- ripples spawned per double-tap -->
	{#each heartbeat.ripples as r (r.id)}
		<span
			class="animate-ripple pointer-events-none absolute block h-24 w-24 rounded-full bg-primary/30"
			style="left: {r.x - 48}px; top: {r.y - 48}px;"
		></span>
	{/each}
</div>
