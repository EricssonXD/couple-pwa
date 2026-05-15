<!--
	HourlyRecorder — F11 capture UI.

	Self-contained 4-state machine:
	  idle  → user taps "Start" → permission+stream acquired
	  recording → 2s auto-stop → previewing
	  previewing → user picks Use / Retry / Cancel
	  uploading → POST upload-attempt → PUT signed URL → POST finalize

	Strings are placeholder English; H8 lands i18n.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import {
		acquireStream,
		HOURLY_CLIP_MS,
		HourlyRecorderError,
		startCapture,
		stopStream,
		uploadClip,
		type CaptureResult
	} from '$lib/hourly/recorder';

	interface Props {
		facingMode?: 'user' | 'environment';
		onsuccess?: () => void;
		oncancel?: () => void;
	}

	let { facingMode: initialFacing = 'user', onsuccess, oncancel }: Props = $props();

	type Phase = 'idle' | 'requesting' | 'recording' | 'previewing' | 'uploading' | 'error';
	let phase: Phase = $state('idle');
	let errorCode: string | null = $state(null);
	// initialFacing is a one-time seed; subsequent prop changes shouldn't
	// hijack an in-flight recording session.
	// svelte-ignore state_referenced_locally
	let facing: 'user' | 'environment' = $state(initialFacing);
	let stream: MediaStream | null = $state(null);
	let captured: CaptureResult | null = $state(null);
	let previewUrl: string | null = $state(null);

	let videoEl: HTMLVideoElement | null = $state(null);

	function teardownStream(): void {
		stopStream(stream);
		stream = null;
	}

	function teardownPreview(): void {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		captured = null;
	}

	function fail(code: string): void {
		errorCode = code;
		phase = 'error';
		teardownStream();
	}

	async function start(): Promise<void> {
		errorCode = null;
		phase = 'requesting';
		try {
			stream = await acquireStream(facing);
			phase = 'recording';
			queueMicrotask(async () => {
				if (videoEl && stream) {
					videoEl.srcObject = stream;
					try {
						await videoEl.play();
					} catch {
						/* autoplay restrictions — preview will still render frames */
					}
				}
				try {
					if (!stream) return;
					captured = await startCapture(stream, { clipMs: HOURLY_CLIP_MS });
					previewUrl = URL.createObjectURL(captured.blob);
					teardownStream();
					phase = 'previewing';
				} catch (e) {
					fail(e instanceof HourlyRecorderError ? e.code : 'unknown');
				}
			});
		} catch (e) {
			fail(e instanceof HourlyRecorderError ? e.code : 'unknown');
		}
	}

	function retry(): void {
		teardownPreview();
		phase = 'idle';
		void start();
	}

	function cancel(): void {
		teardownStream();
		teardownPreview();
		phase = 'idle';
		oncancel?.();
	}

	function flipCamera(): void {
		facing = facing === 'user' ? 'environment' : 'user';
	}

	async function submit(): Promise<void> {
		if (!captured) return;
		phase = 'uploading';
		errorCode = null;
		try {
			const attemptRes = await fetch(resolve('/api/hourly/upload-attempt'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mime: captured.mime })
			});
			if (!attemptRes.ok) throw new Error(await attemptRes.text());
			const attempt = (await attemptRes.json()) as {
				attemptId: string;
				uploadUrl: string;
			};

			await uploadClip(attempt.uploadUrl, captured.blob, captured.mime);

			const finalizeRes = await fetch(resolve('/api/hourly/finalize'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ attemptId: attempt.attemptId })
			});
			if (!finalizeRes.ok) throw new Error(await finalizeRes.text());

			teardownPreview();
			phase = 'idle';
			onsuccess?.();
		} catch (e) {
			errorCode = e instanceof HourlyRecorderError ? e.code : 'upload_failed';
			phase = 'previewing';
		}
	}
</script>

<div class="flex flex-col items-center gap-3">
	{#if phase === 'idle'}
		<p class="text-sm text-base-content/70">
			Capture a 2-second moment of this hour. Camera + mic required.
		</p>
		<PillButton variant="primary" size="lg" onclick={start}>Start recording</PillButton>
		<button type="button" class="text-xs text-base-content/60 underline" onclick={flipCamera}>
			Use {facing === 'user' ? 'rear' : 'front'} camera
		</button>
	{:else if phase === 'requesting'}
		<p class="text-sm text-base-content/70">Requesting camera…</p>
	{:else if phase === 'recording'}
		<div class="relative aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-base-300">
			<video bind:this={videoEl} class="h-full w-full object-cover" muted playsinline autoplay
			></video>
			<span
				class="absolute top-2 left-2 rounded-full bg-error/90 px-2 py-0.5 text-xs font-semibold text-error-content"
			>
				● REC
			</span>
		</div>
		<p class="text-xs text-base-content/60">2 seconds — hold still…</p>
	{:else if phase === 'previewing' && previewUrl}
		<div class="relative aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-base-300">
			<video src={previewUrl} class="h-full w-full object-cover" autoplay loop muted playsinline
			></video>
		</div>
		{#if errorCode}
			<p class="text-xs text-error">Upload failed — try again.</p>
		{/if}
		<div class="flex gap-2">
			<PillButton variant="primary" onclick={submit}>Use this</PillButton>
			<PillButton variant="outline" onclick={retry}>Retry</PillButton>
			<PillButton variant="ghost" onclick={cancel}>Cancel</PillButton>
		</div>
	{:else if phase === 'uploading'}
		<p class="text-sm text-base-content/70">Uploading…</p>
	{:else if phase === 'error'}
		<p class="text-sm text-error">
			{#if errorCode === 'permission_denied'}
				Camera permission was denied. Enable it in your browser settings to record.
			{:else if errorCode === 'camera_unavailable'}
				No camera available on this device.
			{:else if errorCode === 'mediarecorder_unsupported' || errorCode === 'getusermedia_unsupported'}
				This browser doesn't support in-browser recording.
			{:else}
				Something went wrong. Please try again.
			{/if}
		</p>
		<div class="flex gap-2">
			<PillButton variant="primary" onclick={retry}>Try again</PillButton>
			<PillButton variant="ghost" onclick={cancel}>Cancel</PillButton>
		</div>
	{/if}
</div>
