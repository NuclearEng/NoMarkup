/**
 * IndexedDB-backed offline draft store.
 *
 * Lets the web client save listing-creation drafts (or any keyed payload)
 * locally when the network is unavailable, then sync them to the server
 * once the browser regains connectivity. Used by useListings.ts to
 * implement offline draft creation.
 *
 * Storage layout: a single object store named `drafts` keyed by `key`.
 * Each entry holds the raw payload, a creation timestamp, and a
 * lastSyncAttempt cursor used for backoff display in the UI.
 *
 * Why IndexedDB and not localStorage:
 *   - localStorage is synchronous and capped at ~5MB; image-heavy
 *     listing drafts can blow past that.
 *   - IndexedDB is async, larger, and survives across tabs.
 *   - All access in this module is wrapped in promises so the React
 *     layer (hook/component) doesn't need to know about IDB requests.
 */

const DB_NAME = 'nomarkup-offline-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

export interface Draft<T = unknown> {
  /** Stable key — usually a UUID generated client-side. */
  key: string;
  /** Free-form payload — the listing-create input shape. */
  data: T;
  /** Epoch ms — set on saveDraft, immutable thereafter. */
  createdAt: number;
  /** Epoch ms of the most recent sync attempt (success or failure). */
  lastSyncAttempt?: number;
  /** Last sync error message (for UI surfacing). */
  lastError?: string;
}

interface SyncResult {
  synced: number;
  failed: number;
}

/**
 * isAvailable returns true when the runtime has IndexedDB. SSR / older
 * browsers (Safari private mode pre-15) fall back to a no-op store so
 * callers don't have to fork their code paths.
 */
export function isAvailable(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

/**
 * openDB opens (and lazily creates) the drafts database. Returns null
 * when IndexedDB is unavailable.
 */
function openDB(): Promise<IDBDatabase | null> {
  if (!isAvailable()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB open failed'));
    };
  });
}

/**
 * saveDraft persists a draft under the given key. Overwrites any
 * existing entry at the same key — the caller decides whether to
 * generate a fresh UUID or reuse one.
 */
export async function saveDraft(key: string, data: unknown): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const draft: Draft = { key, data, createdAt: Date.now() };
    const req = store.put(draft);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      reject(req.error ?? new Error('saveDraft failed'));
    };
  });
  db.close();
}

/**
 * listDrafts returns every persisted draft, ordered most-recent first.
 * Returns an empty array when IndexedDB is unavailable.
 */
export async function listDrafts(): Promise<Draft[]> {
  const db = await openDB();
  if (!db) return [];
  const drafts = await new Promise<Draft[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const result = req.result as Draft[] | undefined;
      resolve(result ?? []);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('listDrafts failed'));
    };
  });
  db.close();
  return drafts.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * removeDraft deletes the entry at the given key. No-op when missing.
 */
export async function removeDraft(key: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(key);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      reject(req.error ?? new Error('removeDraft failed'));
    };
  });
  db.close();
}

/**
 * markDraftError stamps an error message + lastSyncAttempt on the draft.
 * Used internally by syncDraftsToServer when a single draft fails so the
 * UI can show a per-row error indicator.
 */
async function markDraftError(key: string, message: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const existing = getReq.result as Draft | undefined;
      if (!existing) {
        resolve();
        return;
      }
      const updated: Draft = {
        ...existing,
        lastSyncAttempt: Date.now(),
        lastError: message,
      };
      const putReq = store.put(updated);
      putReq.onsuccess = () => {
        resolve();
      };
      putReq.onerror = () => {
        resolve();
      };
    };
    getReq.onerror = () => {
      resolve();
    };
  });
  db.close();
}

/**
 * Minimal API shape required by syncDraftsToServer. Matches the
 * web/src/lib/api.ts client's `post` signature so callers can pass
 * `api` directly.
 */
export interface SyncableAPI {
  post: <R>(path: string, body?: unknown) => Promise<R>;
}

/**
 * syncDraftsToServer walks every persisted draft, attempts to POST it
 * to /api/v1/listings (the create-listing endpoint), and removes
 * each on success. Failed drafts are kept for retry on the next sync.
 *
 * Returns the synced/failed counts so the caller can surface a toast
 * (or a per-row error indicator).
 */
export async function syncDraftsToServer(
  api: SyncableAPI,
  endpoint = '/api/v1/listings',
): Promise<SyncResult> {
  if (!isAvailable()) return { synced: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }
  const drafts = await listDrafts();
  let synced = 0;
  let failed = 0;
  for (const d of drafts) {
    try {
      await api.post(endpoint, d.data);
      await removeDraft(d.key);
      synced += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : 'sync failed';
      await markDraftError(d.key, message);
    }
  }
  return { synced, failed };
}

/**
 * registerAutoSync wires a `window.online` listener that calls
 * syncDraftsToServer whenever the browser regains connectivity. Returns
 * an unsubscribe function for use in React useEffect cleanups.
 *
 * The event is the right trigger because navigator.onLine flips before
 * the listener fires; calling syncDraftsToServer immediately is safe.
 */
export function registerAutoSync(
  api: SyncableAPI,
  endpoint = '/api/v1/listings',
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => {
    void syncDraftsToServer(api, endpoint);
  };
  window.addEventListener('online', handler);
  return () => {
    window.removeEventListener('online', handler);
  };
}
