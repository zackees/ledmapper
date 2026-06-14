/**
 * Persist the loaded Movie Player video (.rgb bytes) in IndexedDB so it
 * survives navigating away and back (and full reloads). localStorage is too
 * small for raw video, so a single-record object store is used instead.
 *
 * Single current video only — keyed by CURRENT_KEY. Best-effort throughout:
 * any IndexedDB failure resolves to a no-op rather than throwing, so the
 * player keeps working in private-mode / quota-exhausted browsers.
 */

const DB_NAME = 'ledmapper';
const DB_VERSION = 1;
const STORE = 'video';
const CURRENT_KEY = 'current';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        let req: IDBOpenDBRequest;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => { resolve(req.result); };
        req.onerror = () => { resolve(null); };
    });
    return dbPromise;
}

/** Persist the raw .rgb video bytes as the current video. Best-effort. */
export async function saveVideo(bytes: Uint8Array): Promise<void> {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE, 'readwrite');
            // Store a copy so a detached/reused ArrayBuffer can't corrupt it.
            tx.objectStore(STORE).put(bytes.slice(), CURRENT_KEY);
            tx.oncomplete = () => { resolve(); };
            tx.onerror = () => { resolve(); };
            tx.onabort = () => { resolve(); };
        } catch {
            resolve();
        }
    });
}

/** Retrieve the stored current video bytes, or null when none/unavailable. */
export async function getVideo(): Promise<Uint8Array | null> {
    const db = await openDb();
    if (!db) return null;
    return new Promise<Uint8Array | null>((resolve) => {
        try {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(CURRENT_KEY);
            req.onsuccess = () => {
                const val = req.result as unknown;
                if (val instanceof Uint8Array) resolve(val);
                else if (val instanceof ArrayBuffer) resolve(new Uint8Array(val));
                else resolve(null);
            };
            req.onerror = () => { resolve(null); };
        } catch {
            resolve(null);
        }
    });
}

/** Remove the stored current video (e.g. when it no longer matches the map). */
export async function clearVideo(): Promise<void> {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(CURRENT_KEY);
            tx.oncomplete = () => { resolve(); };
            tx.onerror = () => { resolve(); };
            tx.onabort = () => { resolve(); };
        } catch {
            resolve();
        }
    });
}
