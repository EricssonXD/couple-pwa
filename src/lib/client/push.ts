/**
 * Web Push subscription helper (N1, client side).
 *
 * Wraps the navigator.serviceWorker + PushManager dance:
 *   - fetches the VAPID public key (cached for the session)
 *   - converts it from base64url to the Uint8Array applicationServerKey
 *   - subscribes via the active service worker
 *   - persists the subscription via POST /api/push/subscribe
 *
 * Returns the typed subscription state so the UI can render the right
 * affordance (CTA, "enabled", "blocked", "unsupported"). Never auto-
 * prompts — the caller must invoke `enable()` from a user gesture so
 * Safari/Chrome don't reject the prompt.
 */

export type PushSupport =
	| { kind: 'supported' }
	| { kind: 'unsupported'; reason: string }
	| { kind: 'no-public-key' };

let cachedKey: Uint8Array | null = null;

function urlBase64ToUint8Array(b64: string): Uint8Array {
	const padding = '='.repeat((4 - (b64.length % 4)) % 4);
	const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

export function detectSupport(): PushSupport {
	if (typeof window === 'undefined') return { kind: 'unsupported', reason: 'ssr' };
	if (!('serviceWorker' in navigator)) return { kind: 'unsupported', reason: 'no_sw' };
	if (!('PushManager' in window)) return { kind: 'unsupported', reason: 'no_push' };
	if (!('Notification' in window)) return { kind: 'unsupported', reason: 'no_notification' };
	return { kind: 'supported' };
}

async function fetchPublicKey(): Promise<Uint8Array | null> {
	if (cachedKey) return cachedKey;
	const res = await fetch('/api/push/vapid-public-key');
	if (res.status === 503) return null;
	if (!res.ok) throw new Error(`vapid_fetch_failed_${res.status}`);
	const body = (await res.json()) as { key: string };
	cachedKey = urlBase64ToUint8Array(body.key);
	return cachedKey;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
	const support = detectSupport();
	if (support.kind !== 'supported') return null;
	const reg = await navigator.serviceWorker.ready;
	return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<
	| { ok: true; subscription: PushSubscription }
	| { ok: false; reason: 'denied' | 'no_key' | 'unsupported' | 'failed'; error?: unknown }
> {
	const support = detectSupport();
	if (support.kind !== 'supported') return { ok: false, reason: 'unsupported' };

	// Must be called from a user gesture in Safari.
	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return { ok: false, reason: 'denied' };

	const key = await fetchPublicKey();
	if (!key) return { ok: false, reason: 'no_key' };

	try {
		const reg = await navigator.serviceWorker.ready;
		const existing = await reg.pushManager.getSubscription();
		const sub =
			existing ??
			(await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: key as BufferSource
			}));

		const json = sub.toJSON();
		const res = await fetch('/api/push/subscribe', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				endpoint: json.endpoint,
				keys: json.keys,
				userAgent: navigator.userAgent
			})
		});
		if (!res.ok) {
			// Roll back the local subscription so the next attempt re-tries
			// cleanly instead of leaving the browser in an "I'm subscribed
			// but the server doesn't know" state.
			if (!existing) await sub.unsubscribe().catch(() => {});
			return { ok: false, reason: 'failed' };
		}
		return { ok: true, subscription: sub };
	} catch (e) {
		return { ok: false, reason: 'failed', error: e };
	}
}

export async function disablePush(): Promise<{ ok: boolean }> {
	const support = detectSupport();
	if (support.kind !== 'supported') return { ok: true };
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	if (!sub) return { ok: true };
	const endpoint = sub.endpoint;
	await sub.unsubscribe().catch(() => {});
	await fetch('/api/push/subscribe', {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ endpoint })
	}).catch(() => {});
	return { ok: true };
}
