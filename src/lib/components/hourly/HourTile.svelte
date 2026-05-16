<!--
	HourTile — F11 redesign U2.

	One landscape 16:9 tile in the hour pager: shows a person's clip
	for one hour, with a mood emoji sticker in the corner. The "your"
	tile on the current hour also doubles as the capture affordance —
	tapping the empty placeholder invokes `oncapture` which the parent
	uses to open the recorder.

	Pure presentational: no fetch, no state machine. Parent owns the
	day payload and tells us which clip to render.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import CameraIcon from 'phosphor-svelte/lib/Camera';
	import type { Snippet } from 'svelte';

	export type Mood = 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset';

	export interface TileClip {
		id: string;
		mime: string;
		playbackUrl: string;
	}

	interface Props {
		owner: 'you' | 'partner';
		isCurrentHour: boolean;
		clip: TileClip | null;
		mood: Mood | null;
		/** Tapped by the user — parent decides whether to play, expand, or open recorder. */
		ontap?: () => void;
		oncapture?: () => void;
		/** Right-corner accessory (Re-record pill, for example). */
		accessory?: Snippet;
	}

	let { owner, isCurrentHour, clip, mood, ontap, oncapture, accessory }: Props = $props();

	const moodEmoji: Record<Mood, string> = {
		joyful: '😄',
		happy: '🙂',
		neutral: '😐',
		sad: '🙁',
		upset: '😣'
	};

	function handleClick(): void {
		if (clip) {
			ontap?.();
		} else if (owner === 'you' && isCurrentHour) {
			oncapture?.();
		}
	}

	const canCapture = $derived(owner === 'you' && isCurrentHour && !clip);
	const isInteractive = $derived(Boolean(clip) || canCapture);

	const emptyLabel = $derived(() => {
		if (owner === 'you') {
			return isCurrentHour ? m.hourly_tile_empty_current() : m.hourly_tile_empty_past_you();
		}
		return m.hourly_tile_empty_past_partner();
	});

	const ownerLabel = $derived(
		owner === 'you' ? m.hourly_card_you_label() : m.hourly_card_partner_label()
	);
</script>

<div class="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-base-300">
	<!-- owner pill -->
	<span
		class="absolute top-2 left-2 z-10 rounded-full bg-base-100/85 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-base-content/80 uppercase backdrop-blur-sm"
	>
		{ownerLabel}
	</span>

	<!-- mood chip -->
	{#if mood}
		<span
			class="absolute top-2 right-2 z-10 rounded-full bg-base-100/90 px-1.5 py-0.5 text-base backdrop-blur-sm"
			aria-label={mood}
		>
			{moodEmoji[mood]}
		</span>
	{/if}

	{#if clip}
		<button
			type="button"
			class="absolute inset-0 h-full w-full"
			onclick={handleClick}
			aria-label={ownerLabel}
		>
			<video
				src={clip.playbackUrl}
				class="h-full w-full object-cover"
				muted
				playsinline
				autoplay
				loop
			></video>
		</button>
	{:else if canCapture}
		<button
			type="button"
			onclick={handleClick}
			class="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-base-content/20 bg-base-200/50 text-base-content/70 transition-colors hover:bg-base-200/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
			aria-label={m.hourly_tile_empty_current()}
		>
			<CameraIcon size={32} />
			<span class="text-xs font-medium">{m.hourly_tile_empty_current()}</span>
		</button>
	{:else}
		<div
			class="absolute inset-0 flex h-full w-full items-center justify-center bg-base-200/40 text-xs text-base-content/50"
		>
			{emptyLabel()}
		</div>
	{/if}

	{#if accessory}
		<div class="absolute right-2 bottom-2 z-10">
			{@render accessory()}
		</div>
	{/if}

	{#if !isInteractive}
		<!-- a11y: explicitly mark non-interactive empty tiles -->
		<span class="sr-only">{emptyLabel()}</span>
	{/if}
</div>
