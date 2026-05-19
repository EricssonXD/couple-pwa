// F11 — pure client primitive for the 2-second hourly clip capture.
//
// No DOM, no Svelte. Manages getUserMedia + MediaRecorder lifecycle:
//   acquire stream → start record → auto-stop at clipMs → emit Blob
//
// Single-shot per recorder: each capture creates a fresh recorder so
// the underlying MediaStream tracks can be released between attempts
// (battery + privacy). Component re-instantiates on retry.

export const HOURLY_CLIP_MS = 2_000;

// Keep the 2-second clip well under typical Supabase Storage per-object
// limits. iOS Safari MediaRecorder defaults to ~8-15 Mbps which can
// push a 2s clip past 4 MB — we cap to ~800 kbps video + 64 kbps audio
// so a clip lands around 200-300 KB regardless of device.
const HOURLY_VIDEO_BPS = 800_000;
const HOURLY_AUDIO_BPS = 64_000;

// Mime preference order. iOS Safari MediaRecorder ships only video/mp4.
// Chrome / Android picks vp9 first, then vp8.
const MIME_PREFERENCES: ReadonlyArray<{ mime: string; ext: 'webm' | 'mp4' }> = [
	{ mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
	{ mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
	{ mime: 'video/webm', ext: 'webm' },
	{ mime: 'video/mp4', ext: 'mp4' }
];

export type SupportedMime = 'video/webm' | 'video/mp4';

export interface PickedMime {
	/** Full mime passed to MediaRecorder (may include codecs=...) */
	recorderMime: string;
	/** Stripped mime sent to /api/hourly/upload-attempt + Storage. */
	uploadMime: SupportedMime;
}

export function pickSupportedMime(): PickedMime | null {
	if (typeof MediaRecorder === 'undefined') return null;
	for (const candidate of MIME_PREFERENCES) {
		if (MediaRecorder.isTypeSupported(candidate.mime)) {
			return {
				recorderMime: candidate.mime,
				uploadMime: candidate.ext === 'webm' ? 'video/webm' : 'video/mp4'
			};
		}
	}
	return null;
}

export interface CaptureResult {
	blob: Blob;
	mime: SupportedMime;
	durationMs: number;
}

export interface CaptureOptions {
	clipMs?: number;
}

/**
 * Record exactly clipMs from the supplied stream and return the blob.
 * Caller owns the stream lifecycle (so the live preview can keep
 * playing during preview/upload).
 */
export async function startCapture(
	stream: MediaStream,
	opts: CaptureOptions = {}
): Promise<CaptureResult> {
	const picked = pickSupportedMime();
	if (!picked) throw new HourlyRecorderError('mediarecorder_unsupported');

	const clipMs = opts.clipMs ?? HOURLY_CLIP_MS;
	const recorder = new MediaRecorder(stream, {
		mimeType: picked.recorderMime,
		videoBitsPerSecond: HOURLY_VIDEO_BPS,
		audioBitsPerSecond: HOURLY_AUDIO_BPS
	});
	const chunks: Blob[] = [];
	const startTs = performance.now();

	return new Promise((resolve, reject) => {
		recorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) chunks.push(e.data);
		};
		recorder.onerror = () => reject(new HourlyRecorderError('mediarecorder_error'));
		recorder.onstop = () => {
			const blob = new Blob(chunks, { type: picked.uploadMime });
			const durationMs = Math.round(performance.now() - startTs);
			resolve({ blob, mime: picked.uploadMime, durationMs });
		};
		try {
			recorder.start(250);
		} catch {
			reject(new HourlyRecorderError('mediarecorder_start_failed'));
			return;
		}
		// Auto-stop. setTimeout drift is fine — finalize only checks
		// server-side hour-bucket residency, not the exact clip length.
		setTimeout(() => {
			if (recorder.state === 'recording') recorder.stop();
		}, clipMs);
	});
}

/**
 * Pick the widest-FOV back camera deviceId by label heuristic. On Android
 * Chrome a "quad camera" phone exposes each lens (ultrawide, main, tele,
 * macro) as a separate MediaDeviceInfo; facingMode: 'environment' alone
 * usually returns the *main* or *telephoto* lens, which looks like a
 * heavy zoom-in compared to the native camera app (which defaults to
 * ultrawide). Returns null if there's only one back camera (or labels are
 * empty because permission hasn't been granted yet — iOS Safari case).
 */
async function pickWidestBackCameraId(): Promise<string | null> {
	if (!navigator.mediaDevices?.enumerateDevices) return null;
	let devices: MediaDeviceInfo[];
	try {
		devices = await navigator.mediaDevices.enumerateDevices();
	} catch {
		return null;
	}
	const backs = devices.filter(
		(d) => d.kind === 'videoinput' && d.label && !/front|user|selfie|facetime/i.test(d.label)
	);
	if (backs.length <= 1) return null;
	const score = (label: string): number => {
		const l = label.toLowerCase();
		if (/macro|depth|monochrome|ir\b/.test(l)) return -100;
		if (/ultra[\s-]?wide|0\.?5x|wide angle|wide-angle/.test(l)) return 30;
		if (/\btele|zoom|2x|3x|5x|10x/.test(l)) return -20;
		if (/\bwide\b/.test(l)) return 10;
		return 0;
	};
	const ranked = backs.map((d) => ({ d, s: score(d.label) })).sort((a, b) => b.s - a.s);
	if (ranked[0].s <= 0) return null;
	return ranked[0].d.deviceId;
}

export async function acquireStream(
	facingMode: 'user' | 'environment' = 'user',
	aspect: 'square' | 'landscape' | 'portrait' = 'square'
): Promise<MediaStream> {
	if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
		throw new HourlyRecorderError('getusermedia_unsupported');
	}
	// We intentionally request NO width/height/aspectRatio constraints.
	// Phone camera stacks (especially front-facing) often satisfy a small
	// requested resolution by serving a center-cropped sensor region
	// instead of downscaling the full frame, which looks like a heavy
	// unrecoverable zoom-in (track.zoom is optical-only and unavailable
	// on most selfie cameras, so the slider can't back it out). Letting
	// the browser pick the camera's native FOV and downscaling on encode
	// keeps the user's expected framing. File size is bounded by the
	// HOURLY_VIDEO_BPS / HOURLY_AUDIO_BPS caps on MediaRecorder, which is
	// what actually keeps clips under Supabase's per-object limit.
	void aspect;
	const video: MediaTrackConstraints = { facingMode };
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
	} catch (e) {
		const name = (e as { name?: string })?.name ?? '';
		if (name === 'NotAllowedError' || name === 'SecurityError') {
			throw new HourlyRecorderError('permission_denied');
		}
		if (name === 'NotFoundError' || name === 'OverconstrainedError') {
			throw new HourlyRecorderError('camera_unavailable');
		}
		throw new HourlyRecorderError('camera_error');
	}
	// For the rear camera on multi-lens Android devices, try to swap to
	// the ultrawide lens. enumerateDevices() only returns labels after a
	// successful gUM (privacy), so we acquire once, inspect, and re-acquire
	// with deviceId if a wider lens is available. iOS Safari intentionally
	// hides the extra lenses so this is a no-op there.
	if (facingMode === 'environment') {
		try {
			const wideId = await pickWidestBackCameraId();
			if (wideId) {
				const currentId = stream.getVideoTracks()[0]?.getSettings().deviceId;
				if (currentId !== wideId) {
					stream.getTracks().forEach((t) => t.stop());
					stream = await navigator.mediaDevices.getUserMedia({
						video: { deviceId: { exact: wideId } },
						audio: true
					});
				}
			}
		} catch {
			/* keep the original stream if the swap fails */
		}
	}
	// Best-effort continuous autofocus. Not supported on iOS Safari and
	// some desktop browsers — silently ignore.
	const track = stream.getVideoTracks()[0];
	if (track && typeof track.applyConstraints === 'function') {
		try {
			await track.applyConstraints({
				advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet]
			});
		} catch {
			/* not supported, ignore */
		}
	}
	return stream;
}

export interface ZoomCapability {
	min: number;
	max: number;
	step: number;
	current: number;
}

/**
 * Read optical/digital zoom range from the active video track. Returns
 * null on browsers without zoom support (iOS Safari, Firefox).
 */
export function getZoomCapability(stream: MediaStream | null): ZoomCapability | null {
	if (!stream) return null;
	const track = stream.getVideoTracks()[0];
	if (!track || typeof track.getCapabilities !== 'function') return null;
	const caps = track.getCapabilities() as MediaTrackCapabilities & {
		zoom?: { min: number; max: number; step?: number };
	};
	const zoom = caps.zoom;
	if (!zoom || typeof zoom.min !== 'number' || typeof zoom.max !== 'number') return null;
	if (zoom.max <= zoom.min) return null;
	const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
	const current = typeof settings.zoom === 'number' ? settings.zoom : zoom.min;
	return { min: zoom.min, max: zoom.max, step: zoom.step ?? 0.1, current };
}

export async function applyZoom(stream: MediaStream | null, value: number): Promise<void> {
	if (!stream) return;
	const track = stream.getVideoTracks()[0];
	if (!track || typeof track.applyConstraints !== 'function') return;
	try {
		await track.applyConstraints({
			advanced: [{ zoom: value } as MediaTrackConstraintSet]
		});
	} catch {
		/* device rejected — ignore */
	}
}

export function stopStream(stream: MediaStream | null): void {
	if (!stream) return;
	for (const track of stream.getTracks()) track.stop();
}

/**
 * One-shot upload of a captured blob to a Supabase Storage signed
 * upload URL. Throws on non-2xx so the caller can surface a retry UI.
 *
 * iOS Safari quirks worked around here:
 *  - `fetch()` with a Blob body sometimes fails to set Content-Length
 *    correctly on iOS, leading to the upload hanging / server 400. We
 *    read the blob into an ArrayBuffer first so the platform sets a
 *    known-good length.
 *  - We capture the response body on failure so the UI can show the
 *    real Supabase error instead of an opaque "upload_failed".
 */
export async function uploadClip(
	uploadUrl: string,
	blob: Blob,
	mime: SupportedMime
): Promise<void> {
	const body = await blob.arrayBuffer();
	let res: Response;
	try {
		res = await fetch(uploadUrl, {
			method: 'PUT',
			headers: {
				'content-type': mime,
				'cache-control': 'max-age=3600',
				'x-upsert': 'true'
			},
			body
		});
	} catch (e) {
		// Network-level failure (CORS, DNS, offline, iOS aborting on
		// background) — bubble up the real reason instead of swallowing.
		throw new HourlyRecorderError('upload_failed', e instanceof Error ? e.message : String(e));
	}
	if (!res.ok) {
		let detail = `${res.status}`;
		try {
			const text = await res.text();
			if (text) detail += ` ${text.slice(0, 200)}`;
		} catch {
			/* ignore */
		}
		throw new HourlyRecorderError('upload_failed', detail);
	}
}

export type HourlyRecorderErrorCode =
	| 'mediarecorder_unsupported'
	| 'mediarecorder_error'
	| 'mediarecorder_start_failed'
	| 'getusermedia_unsupported'
	| 'permission_denied'
	| 'camera_unavailable'
	| 'camera_error'
	| 'upload_failed';

export class HourlyRecorderError extends Error {
	code: HourlyRecorderErrorCode;
	detail?: string;
	constructor(code: HourlyRecorderErrorCode, detail?: string) {
		super(detail ? `${code}: ${detail}` : code);
		this.code = code;
		this.detail = detail;
		this.name = 'HourlyRecorderError';
	}
}
