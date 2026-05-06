/**
 * Client geolocation tracker. Watches the device GPS, throttles reports to
 * one per 60s OR 50m of movement (whichever comes first — same gates as the
 * server), enriches with battery state when available, and POSTs to
 * /api/location/ping.
 *
 * Returns a Svelte 5 rune-state object the UI can reactively bind to.
 */

import { browser } from '$app/environment';

const MIN_INTERVAL_MS = 60 * 1000;
const MIN_MOVEMENT_M = 50;
const ERROR_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

export type TrackerStatus =
	| 'idle'
	| 'requesting_permission'
	| 'denied'
	| 'unsupported'
	| 'tracking'
	| 'paused'
	| 'error';

interface BatteryLike {
	level: number;
	charging: boolean;
	addEventListener?: (event: string, handler: () => void) => void;
}

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
	const R = 6_371_000;
	const φ1 = (a.lat * Math.PI) / 180;
	const φ2 = (b.lat * Math.PI) / 180;
	const dφ = ((b.lat - a.lat) * Math.PI) / 180;
	const dλ = ((b.lon - a.lon) * Math.PI) / 180;
	const x = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(x));
}

export function createGeolocationTracker() {
	let status = $state<TrackerStatus>('idle');
	let lastError = $state<string | null>(null);
	let lastSentAt = $state<Date | null>(null);
	let lastFix = $state<GeolocationPosition | null>(null);
	let watchId: number | null = null;
	let lastSentCoord: { lat: number; lon: number; t: number } | null = null;
	let battery: BatteryLike | null = null;
	let consecutiveErrors = 0;
	let backoffTimer: ReturnType<typeof setTimeout> | null = null;
	let visibilityHandler: (() => void) | null = null;

	async function loadBattery() {
		if (battery || typeof navigator === 'undefined') return;
		const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
		if (typeof nav.getBattery === 'function') {
			try {
				battery = await nav.getBattery();
			} catch {
				battery = null;
			}
		}
	}

	function shouldSend(pos: GeolocationPosition): boolean {
		if (!lastSentCoord) return true;
		const tDelta = pos.timestamp - lastSentCoord.t;
		if (tDelta >= MIN_INTERVAL_MS) return true;
		const moved = haversineM(
			{ lat: lastSentCoord.lat, lon: lastSentCoord.lon },
			{ lat: pos.coords.latitude, lon: pos.coords.longitude }
		);
		return moved >= MIN_MOVEMENT_M;
	}

	async function sendPing(pos: GeolocationPosition) {
		const body: Record<string, unknown> = {
			lat: pos.coords.latitude,
			lon: pos.coords.longitude,
			accuracyM: pos.coords.accuracy,
			capturedAt: new Date(pos.timestamp).toISOString()
		};
		if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading))
			body.headingDeg = pos.coords.heading;
		if (pos.coords.speed != null && !Number.isNaN(pos.coords.speed))
			body.speedMps = pos.coords.speed;
		if (battery) {
			body.batteryPct = Math.round(battery.level * 100);
			body.charging = battery.charging;
		}

		try {
			const res = await fetch('/api/location/ping', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(`ping ${res.status}`);
			lastSentAt = new Date();
			lastSentCoord = {
				lat: pos.coords.latitude,
				lon: pos.coords.longitude,
				t: pos.timestamp
			};
			consecutiveErrors = 0;
			lastError = null;
			if (status === 'error') status = 'tracking';
		} catch (e) {
			consecutiveErrors++;
			lastError = e instanceof Error ? e.message : String(e);
			status = 'error';
			scheduleRetry(pos);
		}
	}

	function scheduleRetry(pos: GeolocationPosition) {
		if (backoffTimer) clearTimeout(backoffTimer);
		const delay = ERROR_BACKOFF_MS[Math.min(consecutiveErrors - 1, ERROR_BACKOFF_MS.length - 1)];
		backoffTimer = setTimeout(() => void sendPing(pos), delay);
	}

	function onPosition(pos: GeolocationPosition) {
		lastFix = pos;
		if (shouldSend(pos)) void sendPing(pos);
	}

	function onError(err: GeolocationPositionError) {
		lastError = err.message || `code ${err.code}`;
		if (err.code === err.PERMISSION_DENIED) {
			status = 'denied';
			stop();
		} else {
			status = 'error';
		}
	}

	function attachVisibility() {
		if (typeof document === 'undefined' || visibilityHandler) return;
		visibilityHandler = () => {
			if (document.hidden) {
				if (status === 'tracking') status = 'paused';
			} else {
				if (status === 'paused') status = 'tracking';
			}
		};
		document.addEventListener('visibilitychange', visibilityHandler);
	}

	async function start() {
		if (!browser) return;
		if (!('geolocation' in navigator)) {
			status = 'unsupported';
			return;
		}
		if (watchId !== null) return; // already running
		status = 'requesting_permission';
		await loadBattery();
		watchId = navigator.geolocation.watchPosition(onPosition, onError, {
			enableHighAccuracy: true,
			maximumAge: 30_000,
			timeout: 60_000
		});
		status = 'tracking';
		attachVisibility();
	}

	function stop() {
		if (watchId !== null) {
			navigator.geolocation.clearWatch(watchId);
			watchId = null;
		}
		if (backoffTimer) {
			clearTimeout(backoffTimer);
			backoffTimer = null;
		}
		if (visibilityHandler && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', visibilityHandler);
			visibilityHandler = null;
		}
		if (status !== 'denied' && status !== 'unsupported') status = 'idle';
	}

	return {
		get status() {
			return status;
		},
		get lastError() {
			return lastError;
		},
		get lastSentAt() {
			return lastSentAt;
		},
		get lastFix() {
			return lastFix;
		},
		start,
		stop
	};
}

export type GeolocationTracker = ReturnType<typeof createGeolocationTracker>;
