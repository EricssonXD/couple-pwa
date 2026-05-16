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
	import DotsThreeVerticalIcon from 'phosphor-svelte/lib/DotsThreeVertical';
	import type { Snippet } from 'svelte';

	export type Mood = 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset';

	export interface TileClip {
		id: string;
		mime: string;
		playbackUrl: string;
		caption?: string | null;
	}

	interface Props {
		owner: 'you' | 'partner';
		isCurrentHour: boolean;
		clip: TileClip | null;
		mood: Mood | null;
		/** Tapped by the user — parent decides whether to play, expand, or open recorder. */
		ontap?: () => void;
		oncapture?: () => void;
		oneditcaption?: () => void;
		ondelete?: () => void;
		/** Right-corner accessory (Re-record pill, for example). */
		accessory?: Snippet;
	}

	let {
		owner,
		isCurrentHour,
		clip,
		mood,
		ontap,
		oncapture,
		oneditcaption,
		ondelete,
		accessory
	}: Props = $props();

	const moodEmoji: Record<Mood, string> = {
		joyful: '😄',
		happy: '🙂',
		neutral: '😐',
		sad: '🙁',
		upset: '😣'
	};

	let menuOpen = $state(false);

	function handleClick(): void {
		if (clip) {
			ontap?.();
		} else if (owner === 'you' && isCurrentHour) {
			oncapture?.();
		}
	}

	function toggleMenu(e: MouseEvent): void {
		e.stopPropagation();
		menuOpen = !menuOpen;
	}

	function pickEdit(e: MouseEvent): void {
		e.stopPropagation();
		menuOpen = false;
		oneditcaption?.();
	}

	function pickDelete(e: MouseEvent): void {
		e.stopPropagation();
		menuOpen = false;
		ondelete?.();
	}

	const canCapture = $derived(owner === 'you' && isCurrentHour && !clip);
	const isInteractive = $derived(Boolean(clip) || canCapture);
	const showMenu = $derived(Boolean(clip) && owner === 'you' && isCurrentHour);

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

<div class="relative aspect-[9/16] w-full overflow-hidden rounded-[var(--radius-card)] bg-base-300">
	<!-- owner pill -->
	<span
		class="absolute top-2 left-2 z-10 rounded-full bg-base-100/85 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-base-content/80 uppercase backdrop-blur-sm"
	>
		{ownerLabel}
	</span>

	<!-- mood chip -->
	{#if mood}
		<span
			class="absolute top-2 right-2 z-10 rounded-full bg-base-100/90 px-1.5 py-0.5 text-base backdrop-blur-sm {showMenu
				? 'right-10'
				: ''}"
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
				class="h-full w-full bg-black object-cover"
				muted
				playsinline
				autoplay
				loop
			></video>
		</button>
		{#if clip.caption}
			<div
				class="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 px-3 text-center text-sm font-semibold text-white"
				style="text-shadow: 0 1px 3px rgba(0,0,0,0.7), 0 0 8px rgba(0,0,0,0.4);"
			>
				{clip.caption}
			</div>
		{/if}
		{#if showMenu}
			<button
				type="button"
				class="absolute top-1.5 right-1.5 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
				aria-label="Clip options"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				onclick={toggleMenu}
			>
				<DotsThreeVerticalIcon size={18} weight="bold" />
			</button>
			{#if menuOpen}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="fixed inset-0 z-30"
					onclick={(e) => {
						e.stopPropagation();
						menuOpen = false;
					}}
				></div>
				<div
					role="menu"
					class="absolute top-10 right-1.5 z-40 flex min-w-[10rem] flex-col overflow-hidden rounded-lg bg-base-100 text-sm shadow-lg ring-1 ring-base-content/10"
				>
					<button
						type="button"
						role="menuitem"
						class="px-3 py-2 text-left hover:bg-base-200"
						onclick={pickEdit}
					>
						{m.hourly_tile_menu_edit_caption()}
					</button>
					<button
						type="button"
						role="menuitem"
						class="px-3 py-2 text-left text-error hover:bg-base-200"
						onclick={pickDelete}
					>
						{m.hourly_tile_menu_delete()}
					</button>
				</div>
			{/if}
		{/if}
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
