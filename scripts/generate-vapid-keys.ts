#!/usr/bin/env bun
/**
 * Generate a VAPID keypair for Web Push (N1).
 *
 * Run with: `bun scripts/generate-vapid-keys.ts`.
 *
 * Output (paste into your secret store / .env):
 *   PUBLIC_VAPID_KEY="..."   ← published via /api/push/vapid-public-key
 *   PRIVATE_VAPID_KEY="..."  ← Worker secret, consumed only by N3 delivery
 *   VAPID_SUBJECT="mailto:you@example.com"
 *
 * Uses Node's WebCrypto so it works without pulling in the `web-push`
 * runtime dependency in this script. The N3 worker will use `web-push`
 * (or jsr:@negrel/webpush) to actually send notifications.
 */
import { webcrypto } from 'node:crypto';

function base64UrlEncode(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let bin = '';
	for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
	const subtle = (webcrypto as unknown as { subtle: SubtleCrypto }).subtle;
	const keyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);

	// Public key in raw uncompressed form (65 bytes, 0x04 prefix).
	const rawPub = await subtle.exportKey('raw', keyPair.publicKey);
	// Private key as JWK so we can extract the 32-byte `d` scalar.
	const jwk = await subtle.exportKey('jwk', keyPair.privateKey);
	if (!jwk.d) throw new Error('exported JWK is missing private scalar');

	const publicB64 = base64UrlEncode(rawPub);
	// The JWK `d` is already base64url-encoded.
	const privateB64 = jwk.d;

	console.log('# VAPID keys generated. Add these to your secret store:');
	console.log(`PUBLIC_VAPID_KEY="${publicB64}"`);
	console.log(`PRIVATE_VAPID_KEY="${privateB64}"`);
	console.log('VAPID_SUBJECT="mailto:you@example.com"  # CHANGE ME');
	console.log('');
	console.log('# Cloudflare Workers:');
	console.log('#   wrangler secret put PRIVATE_VAPID_KEY');
	console.log('#   wrangler secret put VAPID_SUBJECT');
	console.log('# PUBLIC_VAPID_KEY can be a plain `vars` entry in wrangler.jsonc');
	console.log('# (it is non-secret by definition — it ships to every browser).');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
