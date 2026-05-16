<!--
HourlyRecorder — F11 fullscreen camera capture UI (U6).

Fills its parent (the page wraps it in a fixed inset-0 overlay).
Auto-acquires the camera stream on mount so the viewfinder appears
immediately, with a large shutter button at the bottom — matching
native camera-app affordances.

State machine:
  requesting → user grants permission, stream attached
  ready → viewfinder live, shutter armed
  recording → 2s auto-stop, progress ring around shutter
  previewing → loop preview + Use/Retry/Cancel
  uploading → optimistic UX while finalize runs
  error → permission/unsupported overlay
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import XIcon from 'phosphor-svelte/lib/X';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
	import {
		acquireStream,
		applyZoom,
		getZoomCapability,
		HOURLY_CLIP_MS,
		HourlyRecorderError,
		startCapture,
		stopStream,
		uploadClip,
		type CaptureResult,
		type ZoomCapability
	} from '$lib/hourly/recorder';

	interface Props {
		facingMode?: 'user' | 'environment';
		aspect?: 'square' | 'landscape' | 'portrait';
		onsuccess?: () => void;
		oncancel?: () => void;
	}

	let {
		facingMode: initialFacing = 'user',
		aspect = 'landscape',
		onsuccess,
		oncancel
	}: Props = $props();

	type Phase = 'requesting' | 'ready' | 'recording' | 'previewing' | 'uploading' | 'error';
	let phase: Phase = $state('requesting');
	let errorCode: string | null = $state(null);
	let uploadErrorDetail: string | null = $state(null);
	// initialFacing is a one-time seed; subsequent prop changes shouldn't
	// hijack an in-flight recording session.
	// svelte-ignore state_referenced_locally
	let facing: 'user' | 'environment' = $state(initialFacing);
	let stream: MediaStream | null = $state(null);
	let captured: CaptureResult | null = $state(null);
	let previewUrl: string | null = $state(null);
	let recordProgress = $state(0);

	let videoEl: HTMLVideoElement | null = $state(null);
	let progressTimer: ReturnType<typeof setInterval> | null = null;
	let caption = $state('');
	let isPortraitClip = $state(false);

	const CAPTION_MAX = 280;

	function onPreviewLoaded(e: Event): void {
		const v = e.currentTarget as HTMLVideoElement;
		isPortraitClip = v.videoHeight > v.videoWidth;
	}

	// Zoom — optional, only when the underlying MediaTrack exposes
	// `zoom` capability (Chromium on Android). On iOS Safari the slider
	// + gestures simply don't render.
	let zoomCap: ZoomCapability | null = $state(null);
	let zoom = $state(1);
	let pinchInitialDist = 0;
	let pinchInitialZoom = 1;
	let dragStartY: number | null = null;
	let dragStartZoom = 1;

	function clampZoom(v: number): number {
		if (!zoomCap) return v;
		return Math.min(zoomCap.max, Math.max(zoomCap.min, v));
	}

	function setZoom(v: number): void {
		const next = clampZoom(v);
		zoom = next;
		void applyZoom(stream, next);
	}

	function touchDistance(t: TouchList): number {
		if (t.length < 2) return 0;
		const dx = t[0].clientX - t[1].clientX;
		const dy = t[0].clientY - t[1].clientY;
		return Math.hypot(dx, dy);
	}

	function zoomActive(): boolean {
		return (phase === 'ready' || phase === 'recording') && zoomCap !== null;
	}

	function onViewfinderTouchStart(e: TouchEvent): void {
		if (!zoomActive()) return;
		if (e.touches.length === 2) {
			pinchInitialDist = touchDistance(e.touches);
			pinchInitialZoom = zoom;
			dragStartY = null;
		} else if (e.touches.length === 1) {
			dragStartY = e.touches[0].clientY;
			dragStartZoom = zoom;
		}
	}

	function onViewfinderTouchMove(e: TouchEvent): void {
		if (!zoomActive() || !zoomCap) return;
		if (e.touches.length === 2 && pinchInitialDist > 0) {
			e.preventDefault();
			const ratio = touchDistance(e.touches) / pinchInitialDist;
			setZoom(pinchInitialZoom * ratio);
		} else if (e.touches.length === 1 && dragStartY !== null) {
			// Drag up = zoom in, drag down = zoom out. 250px of drag
			// spans the full range so subtle movement still nudges.
			const dy = dragStartY - e.touches[0].clientY;
			const range = zoomCap.max - zoomCap.min;
			setZoom(dragStartZoom + (dy / 250) * range);
		}
	}

	function onViewfinderTouchEnd(): void {
		pinchInitialDist = 0;
		dragStartY = null;
	}

	function teardownStream(): void {
		stopStream(stream);
		stream = null;
	}

	function teardownPreview(): void {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		captured = null;
	}

	function clearProgress(): void {
		if (progressTimer) {
			clearInterval(progressTimer);
			progressTimer = null;
		}
		recordProgress = 0;
	}

	function fail(code: string): void {
		errorCode = code;
		phase = 'error';
		teardownStream();
		clearProgress();
	}

	async function acquire(): Promise<void> {
		errorCode = null;
		phase = 'requesting';
		try {
			stream = await acquireStream(facing, aspect);
			zoomCap = getZoomCapability(stream);
			zoom = zoomCap ? zoomCap.current : 1;
			phase = 'ready';
			queueMicrotask(async () => {
				if (videoEl && stream) {
					videoEl.srcObject = stream;
					try {
						await videoEl.play();
					} catch {
						/* autoplay restrictions — viewfinder will still render frames */
					}
				}
			});
		} catch (e) {
			fail(e instanceof HourlyRecorderError ? e.code : 'unknown');
		}
	}

	async function record(): Promise<void> {
		if (!stream) return;
		phase = 'recording';
		recordProgress = 0;
		const tick = 50;
		progressTimer = setInterval(() => {
			recordProgress = Math.min(1, recordProgress + tick / HOURLY_CLIP_MS);
		}, tick);
		try {
			captured = await startCapture(stream, { clipMs: HOURLY_CLIP_MS });
			previewUrl = URL.createObjectURL(captured.blob);
			teardownStream();
			clearProgress();
			phase = 'previewing';
		} catch (e) {
			fail(e instanceof HourlyRecorderError ? e.code : 'unknown');
		}
	}

	function retry(): void {
		teardownPreview();
		uploadErrorDetail = null;
		isPortraitClip = false;
		void acquire();
	}

	function cancel(): void {
		teardownStream();
		teardownPreview();
		clearProgress();
		caption = '';
		isPortraitClip = false;
		zoomCap = null;
		oncancel?.();
	}

	async function flipCamera(): Promise<void> {
		facing = facing === 'user' ? 'environment' : 'user';
		teardownStream();
		await acquire();
	}

	async function submit(): Promise<void> {
		if (!captured) return;
		const trimmedCaption = caption.trim();
		if (trimmedCaption.length > CAPTION_MAX) return;
		phase = 'uploading';
		errorCode = null;
		uploadErrorDetail = null;
		try {
			const attemptRes = await fetch(resolve('/api/hourly/upload-attempt'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mime: captured.mime })
			});
			if (!attemptRes.ok) {
				throw new Error(`attempt: ${attemptRes.status} ${await attemptRes.text()}`);
			}
			const attempt = (await attemptRes.json()) as {
				attemptId: string;
				uploadUrl: string;
			};

			await uploadClip(attempt.uploadUrl, captured.blob, captured.mime);

			const finalizeRes = await fetch(resolve('/api/hourly/finalize'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					attemptId: attempt.attemptId,
					caption: trimmedCaption.length > 0 ? trimmedCaption : null
				})
			});
			if (!finalizeRes.ok) {
				throw new Error(`finalize: ${finalizeRes.status} ${await finalizeRes.text()}`);
			}

			teardownPreview();
			caption = '';
			isPortraitClip = false;
			onsuccess?.();
		} catch (e) {
			uploadErrorDetail = e instanceof Error ? e.message : String(e);
			errorCode = e instanceof HourlyRecorderError ? e.code : 'upload_failed';
			phase = 'previewing';
		}
	}

	$effect(() => {
		void acquire();
	});

	onDestroy(() => {
		teardownStream();
		teardownPreview();
		clearProgress();
	});
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-black text-white">
	{#if phase === 'requesting'}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<p class="text-sm text-white/70">{m.hourly_rec_requesting()}</p>
		</div>
	{:else if phase === 'error'}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<p class="text-base">
				{#if errorCode === 'permission_denied'}
					{m.hourly_rec_err_permission()}
				{:else if errorCode === 'camera_unavailable'}
					{m.hourly_rec_err_unavailable()}
				{:else if errorCode === 'mediarecorder_unsupported' || errorCode === 'getusermedia_unsupported'}
					{m.hourly_rec_err_unsupported()}
				{:else}
					{m.hourly_rec_err_generic()}
				{/if}
			</p>
			{#if errorCode === 'permission_denied'}
				<p class="max-w-sm text-xs text-white/60">
					{m.hourly_rec_err_permission_hint()}
				</p>
			{/if}
			<div class="flex gap-2 pt-2">
				<PillButton variant="primary" onclick={retry}>{m.hourly_rec_try_again()}</PillButton>
				<PillButton variant="ghost" onclick={cancel}>{m.common_cancel()}</PillButton>
			</div>
		</div>
	{:else}
		<div
			class="viewfinder relative flex-1 overflow-hidden bg-black"
			role="region"
			aria-label="Viewfinder"
			ontouchstart={onViewfinderTouchStart}
			ontouchmove={onViewfinderTouchMove}
			ontouchend={onViewfinderTouchEnd}
			ontouchcancel={onViewfinderTouchEnd}
		>
			{#if phase === 'previewing' && previewUrl}
				<video
					src={previewUrl}
					class="preview-video {isPortraitClip ? 'preview-portrait' : 'preview-landscape'}"
					autoplay
					loop
					muted
					playsinline
					onloadedmetadata={onPreviewLoaded}
				></video>
				<div class="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
					<textarea
						bind:value={caption}
						maxlength={CAPTION_MAX}
						rows="2"
						placeholder={m.hourly_rec_caption_placeholder()}
						aria-label={m.hourly_rec_caption_placeholder()}
						class="pointer-events-auto w-full max-w-md resize-none rounded-lg bg-black/40 px-4 py-2 text-center text-lg font-semibold text-white shadow-lg backdrop-blur-sm placeholder:text-white/60 focus:bg-black/60 focus:outline-none"
						style="text-shadow: 0 1px 3px rgba(0,0,0,0.6);"
					></textarea>
				</div>
			{:else}
				<video
					bind:this={videoEl}
					class="h-full w-full object-cover {facing === 'user' ? 'scale-x-[-1]' : ''}"
					muted
					playsinline
					autoplay
				></video>
			{/if}

			<button
				type="button"
				class="absolute top-4 left-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur"
				aria-label={m.common_cancel()}
				onclick={cancel}
			>
				<XIcon size={22} weight="bold" />
			</button>

			{#if phase === 'ready'}
				<button
					type="button"
					class="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur"
					aria-label={facing === 'user' ? m.hourly_rec_use_rear() : m.hourly_rec_use_front()}
					onclick={flipCamera}
				>
					<ArrowsClockwiseIcon size={22} weight="bold" />
				</button>
			{/if}

			{#if (phase === 'ready' || phase === 'recording') && zoomCap}
				<div
					class="absolute top-1/2 right-4 flex h-48 -translate-y-1/2 flex-col items-center gap-2 rounded-full bg-black/40 px-2 py-3 backdrop-blur"
				>
					<span class="text-[10px] font-semibold tracking-wide text-white/80"
						>{zoom.toFixed(1)}x</span
					>
					<input
						type="range"
						class="zoom-slider"
						min={zoomCap.min}
						max={zoomCap.max}
						step={zoomCap.step}
						value={zoom}
						aria-label={m.hourly_rec_zoom_label()}
						oninput={(e) => setZoom(Number((e.currentTarget as HTMLInputElement).value))}
					/>
				</div>
			{/if}

			{#if phase === 'recording'}
				<div
					class="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-error/90 px-3 py-1 text-xs font-semibold"
				>
					● REC
				</div>
			{/if}

			{#if uploadErrorDetail && phase === 'previewing'}
				<div
					class="absolute top-4 right-4 left-16 max-w-sm rounded-lg bg-error/90 px-3 py-2 text-xs"
				>
					{m.hourly_rec_upload_failed()}
					<div class="mt-1 text-[10px] break-words opacity-80">{uploadErrorDetail}</div>
				</div>
			{/if}
		</div>

		<div class="flex shrink-0 items-center justify-center gap-4 bg-black/80 px-4 pt-4 pb-8">
			{#if phase === 'ready'}
				<button
					type="button"
					class="relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-white"
					aria-label={m.hourly_rec_start()}
					onclick={record}
				>
					<span class="h-14 w-14 rounded-full bg-white"></span>
				</button>
			{:else if phase === 'recording'}
				<div class="relative flex h-20 w-20 items-center justify-center">
					<svg class="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
						<circle
							cx="40"
							cy="40"
							r="36"
							fill="none"
							stroke="rgba(255,255,255,0.25)"
							stroke-width="4"
						/>
						<circle
							cx="40"
							cy="40"
							r="36"
							fill="none"
							stroke="#ef4444"
							stroke-width="4"
							stroke-dasharray={2 * Math.PI * 36}
							stroke-dashoffset={(1 - recordProgress) * 2 * Math.PI * 36}
							stroke-linecap="round"
						/>
					</svg>
					<span class="h-10 w-10 rounded-md bg-error"></span>
				</div>
			{:else if phase === 'previewing'}
				<PillButton variant="ghost" onclick={retry}>{m.hourly_rec_retry()}</PillButton>
				<PillButton variant="primary" onclick={submit}>{m.hourly_rec_use_this()}</PillButton>
			{:else if phase === 'uploading'}
				<p class="text-sm text-white/80">{m.hourly_rec_uploading()}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.zoom-slider {
		-webkit-appearance: slider-vertical;
		appearance: slider-vertical;
		writing-mode: vertical-lr;
		direction: rtl;
		width: 1.5rem;
		height: 100%;
		background: transparent;
		accent-color: #fff;
	}
	/*
	  Same trick HourTile uses: container queries let a portrait clip
	  rotate 90° and size itself from the swapped viewfinder dimensions
	  so it fills the preview cleanly when the viewfinder is landscape,
	  and stays upright + uncropped regardless of viewport orientation.
	*/
	.viewfinder {
		container-type: size;
	}
	.preview-video {
		display: block;
	}
	.preview-landscape {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.preview-portrait {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 100cqh;
		height: 100cqw;
		transform: translate(-50%, -50%) rotate(90deg);
		transform-origin: center;
		object-fit: cover;
	}
</style>
