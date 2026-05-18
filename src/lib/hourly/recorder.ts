// F11 — pure client primitive for the 2-second hourly clip capture.
//
// No DOM, no Svelte. Manages getUserMedia + MediaRecorder lifecycle:
//   acquire stream → start record → auto-stop at clipMs → emit Blob
//
// Single-shot per recorder: each capture creates a fresh recorder so
// the underlying MediaStream tracks can be released between attempts
// (battery + privacy). Component re-instantiates on retry.

export const HOURLY_CLIP_MS = 2_000;

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
	const recorder = new MediaRecorder(stream, { mimeType: picked.recorderMime });
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

export async function acquireStream(
	facingMode: 'user' | 'environment' = 'user',
	aspect: 'square' | 'landscape' | 'portrait' = 'square'
): Promise<MediaStream> {
	if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
		throw new HourlyRecorderError('getusermedia_unsupported');
	}
	let video: MediaTrackConstraints;
	if (aspect === 'landscape') {
		video = {
			facingMode,
			width: { ideal: 1280 },
			height: { ideal: 720 },
			aspectRatio: { ideal: 16 / 9 }
		};
	} else if (aspect === 'portrait') {
		video = {
			facingMode,
			width: { ideal: 720 },
			height: { ideal: 1280 },
			aspectRatio: { ideal: 9 / 16 }
		};
	} else {
		video = { facingMode, width: { ideal: 480 }, height: { ideal: 480 } };
	}
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
