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
	aspect: 'square' | 'landscape' = 'square'
): Promise<MediaStream> {
	if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
		throw new HourlyRecorderError('getusermedia_unsupported');
	}
	const video: MediaTrackConstraints =
		aspect === 'landscape'
			? {
					facingMode,
					width: { ideal: 1280 },
					height: { ideal: 720 },
					aspectRatio: { ideal: 16 / 9 }
				}
			: { facingMode, width: { ideal: 480 }, height: { ideal: 480 } };
	try {
		return await navigator.mediaDevices.getUserMedia({ video, audio: true });
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
}

export function stopStream(stream: MediaStream | null): void {
	if (!stream) return;
	for (const track of stream.getTracks()) track.stop();
}

/**
 * One-shot upload of a captured blob to a Supabase Storage signed
 * upload URL. Throws on non-2xx so the caller can surface a retry UI.
 */
export async function uploadClip(
	uploadUrl: string,
	blob: Blob,
	mime: SupportedMime
): Promise<void> {
	const res = await fetch(uploadUrl, {
		method: 'PUT',
		headers: { 'content-type': mime },
		body: blob
	});
	if (!res.ok) throw new HourlyRecorderError('upload_failed');
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
	constructor(code: HourlyRecorderErrorCode) {
		super(code);
		this.code = code;
		this.name = 'HourlyRecorderError';
	}
}
