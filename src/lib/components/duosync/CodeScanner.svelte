<!--
  CodeScanner — opens the rear camera and tries to read a DuoSync pair
  code via the BarcodeDetector API.

  Scope (G1):
  - Feature-detect BarcodeDetector. If unavailable (iOS Safari, older
    Chrome), the parent should hide this component or show the manual
    code field instead — we render nothing useful here.
  - If granted, stream the rear-facing camera into a hidden <video>,
    poll once per 250ms, and emit `oncode(code)` on the first valid
    DuoSync code we find.
  - Cleans up the MediaStream on unmount or success.

  We deliberately accept either:
    a) raw 6-char alphanumeric codes, OR
    b) URLs of the form `${origin}/onboarding/link?code=ABC123`
  so users can scan an old-style QR or the new shareable URL.
-->
<script module lang="ts">
	export function isCodeScannerSupported(): boolean {
		if (typeof window === 'undefined') return false;
		return !!(window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
	}
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import CameraIcon from 'phosphor-svelte/lib/CameraIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';

	type DetectorCtor = new (opts: { formats: string[] }) => {
		detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
	};

	const detectorCtor = $derived.by<DetectorCtor | null>(() => {
		if (typeof window === 'undefined') return null;
		return (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector ?? null;
	});

	let { oncode }: { oncode: (code: string) => void } = $props();

	let scanning = $state(false);
	let error = $state<string | null>(null);
	let videoEl: HTMLVideoElement | undefined = $state();
	let stream: MediaStream | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	function extractCode(raw: string): string | null {
		const trimmed = raw.trim();
		try {
			const u = new URL(trimmed);
			const c = u.searchParams.get('code');
			if (c && /^[A-Z0-9]{4,10}$/.test(c.toUpperCase())) return c.toUpperCase();
		} catch {
			// not a URL — fall through to plain code path
		}
		const upper = trimmed.toUpperCase();
		if (/^[A-Z0-9]{4,10}$/.test(upper)) return upper;
		return null;
	}

	async function start() {
		const Detector = detectorCtor;
		if (!Detector) {
			error = 'Camera scanning is not supported on this browser.';
			return;
		}
		error = null;
		scanning = true;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' } },
				audio: false
			});
			if (!videoEl) throw new Error('video element missing');
			videoEl.srcObject = stream;
			await videoEl.play();
			const detector = new Detector({ formats: ['qr_code'] });
			pollTimer = setInterval(async () => {
				if (!videoEl) return;
				try {
					const results = await detector.detect(videoEl);
					for (const r of results) {
						const code = extractCode(r.rawValue);
						if (code) {
							stop();
							oncode(code);
							return;
						}
					}
				} catch {
					// transient detection errors are non-fatal
				}
			}, 250);
		} catch (e) {
			scanning = false;
			error = e instanceof Error ? e.message : 'Could not open the camera.';
			stop();
		}
	}

	function stop() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		if (stream) {
			for (const t of stream.getTracks()) t.stop();
			stream = null;
		}
		scanning = false;
	}

	onDestroy(() => stop());
</script>

{#if !scanning}
	<button
		type="button"
		class="inline-flex w-full items-center justify-center gap-2 rounded-full border border-base-content/15 py-2.5 text-xs font-semibold tracking-wider uppercase hover:bg-base-300"
		onclick={start}
	>
		<Icon icon={CameraIcon} size={14} weight="duotone" />
		Scan partner's code
	</button>
	{#if error}
		<p class="mt-2 text-center text-xs text-error">{error}</p>
	{/if}
{:else}
	<div class="relative overflow-hidden rounded-[var(--radius-card)] bg-black">
		<video bind:this={videoEl} class="h-64 w-full object-cover" muted playsinline></video>
		<button
			type="button"
			aria-label="Stop scanning"
			class="absolute top-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white"
			onclick={stop}
		>
			<Icon icon={XIcon} size={16} weight="bold" />
		</button>
		<div
			class="pointer-events-none absolute inset-x-12 inset-y-8 rounded-2xl border-2 border-white/70"
		></div>
	</div>
{/if}
