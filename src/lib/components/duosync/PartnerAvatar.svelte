<!--
  PartnerAvatar — circular avatar with a battery ring + presence dot.

  Layout: SVG ring (battery), inside it the avatar (emoji or img),
  and a small status dot anchored to the bottom-right.

  Battery ring: stroke length encodes batteryPct. Color shifts red
  under 20% so the partner's low battery is glanceable.

  presence states:
    online  — sage dot, animate-presence-pulse
    away    — warm gold dot, no pulse
    ghost   — slate dot, ghost icon overlay
    offline — empty/grey dot, no pulse

  Battery ring color steps:
    null         → base-300 (no data)
    <20%         → --color-warning (gold, soft alert — never red, per voice)
    <40%         → --color-accent (warmer gold)
    ≥40%         → --color-secondary (sage)
-->
<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { GhostIcon } from '$lib/components/ui/icons';
	import LightningIcon from 'phosphor-svelte/lib/LightningIcon';

	type Presence = 'online' | 'away' | 'ghost' | 'offline';

	type Props = {
		displayName: string;
		avatarEmoji?: string | null;
		avatarUrl?: string | null;
		presence?: Presence;
		batteryPct?: number | null;
		charging?: boolean;
		size?: number;
	};

	let {
		displayName,
		avatarEmoji = '🌱',
		avatarUrl = null,
		presence = 'online',
		batteryPct = null,
		charging = false,
		size = 72
	}: Props = $props();

	const stroke = 4;
	const radius = $derived((size - stroke) / 2);
	const circumference = $derived(2 * Math.PI * radius);
	const dashOffset = $derived.by(() => {
		if (batteryPct == null) return circumference;
		const pct = Math.max(0, Math.min(100, batteryPct));
		return circumference * (1 - pct / 100);
	});

	const ringColor = $derived.by(() => {
		if (batteryPct == null) return 'var(--color-base-300)';
		if (batteryPct < 20) return 'var(--color-warning)';
		if (batteryPct < 40) return 'var(--color-accent)';
		return 'var(--color-secondary)';
	});

	const dotClass = $derived(
		(
			{
				online: 'bg-secondary text-secondary animate-presence-pulse',
				away: 'bg-accent',
				ghost: 'bg-base-content/40',
				offline: 'bg-base-content/20'
			} satisfies Record<Presence, string>
		)[presence]
	);
</script>

<div class="relative inline-block" style="width: {size}px; height: {size}px;">
	<svg class="absolute inset-0 -rotate-90" width={size} height={size} aria-hidden="true">
		<circle
			cx={size / 2}
			cy={size / 2}
			r={radius}
			fill="none"
			stroke="var(--color-base-300)"
			stroke-width={stroke}
			opacity="0.4"
		/>
		{#if batteryPct != null}
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke={ringColor}
				stroke-width={stroke}
				stroke-linecap="round"
				stroke-dasharray={circumference}
				stroke-dashoffset={dashOffset}
				style="transition: stroke-dashoffset .6s ease, stroke .3s;"
			/>
		{/if}
	</svg>

	<div
		class="absolute grid place-items-center overflow-hidden rounded-full bg-base-200"
		style="inset: {stroke + 2}px;"
		aria-label={displayName}
	>
		{#if avatarUrl}
			<img src={avatarUrl} alt="" class="h-full w-full object-cover" />
		{:else}
			<span class="leading-none" style="font-size: {Math.round(size * 0.45)}px;">{avatarEmoji}</span
			>
		{/if}
	</div>

	<!-- presence dot -->
	<span
		class="absolute right-0 bottom-0 grid h-4 w-4 place-items-center rounded-full ring-2 ring-base-100 {dotClass}"
		aria-label="presence: {presence}"
	>
		{#if presence === 'ghost'}
			<Icon icon={GhostIcon} size={10} weight="fill" class="text-base-100" />
		{/if}
	</span>

	{#if charging && batteryPct != null}
		<span class="absolute top-0 right-0 text-accent" aria-label="charging" title="Charging">
			<Icon icon={LightningIcon} size={14} weight="fill" />
		</span>
	{/if}
</div>
