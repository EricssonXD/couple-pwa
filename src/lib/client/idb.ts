// Tiny IndexedDB key-value store. We don't need the full power of idb here —
// the goal is just to persist small JSON snapshots (per-couple pulse state,
// later: chat tail, geo-moments) so the app boots from cache instantly.
//
// Single database, single object store keyed by string. Values are arbitrary
// JSON-serializable objects. All operations resolve to undefined / value and
// swallow errors — caller code must tolerate cache misses.

const DB_NAME = 'duosync-cache';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('indexedDB unavailable'));
	}
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
	try {
		const db = await openDb();
		return await new Promise<T | undefined>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readonly');
			const req = tx.objectStore(STORE).get(key);
			req.onsuccess = () => resolve(req.result as T | undefined);
			req.onerror = () => reject(req.error);
		});
	} catch {
		return undefined;
	}
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
	try {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			tx.objectStore(STORE).put(value, key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		/* swallow — best-effort cache */
	}
}

export async function idbDel(key: string): Promise<void> {
	try {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			tx.objectStore(STORE).delete(key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		/* swallow */
	}
}
