// Tests for the IndexedDB-backed offline draft store.
//
// jsdom ships no IndexedDB, so this file drives the module through a small
// in-memory double that mirrors the exact surface `offline-drafts.ts` touches:
// `open()` with `onupgradeneeded`/`onsuccess`/`onerror`, a `drafts` object
// store with `put`/`get`/`getAll`/`delete`, and `close()`. Every callback is
// deferred to a macrotask, like the real API, so the module's
// "attach handlers after issuing the request" pattern is exercised for real
// rather than being short-circuited by a synchronous stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isAvailable,
  listDrafts,
  registerAutoSync,
  removeDraft,
  saveDraft,
  syncDraftsToServer,
  type Draft,
  type SyncableAPI,
} from '@/lib/offline-drafts';

const STORE_NAME = 'drafts';

/** Which operations the double should fail, so error arms are reachable. */
interface FailureConfig {
  open: boolean;
  /** When true, `open` rejects with a null `error` (the `?? new Error` arm). */
  openWithNullError: boolean;
  put: boolean;
  getAll: boolean;
  /** `getAll` resolves with `undefined` (the `?? []` arm). */
  getAllUndefined: boolean;
  get: boolean;
  delete: boolean;
}

const failures: FailureConfig = {
  open: false,
  openWithNullError: false,
  put: false,
  getAll: false,
  getAllUndefined: false,
  get: false,
  delete: false,
};

let records = new Map<string, Draft>();
let existingStores = new Set<string>();
let closeCount = 0;

type Handler = (() => void) | null;

class FakeRequest<T> {
  result: T | undefined = undefined;
  error: DOMException | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;

  succeed(result?: T): void {
    this.result = result;
    this.onsuccess?.();
  }

  fail(error: DOMException | null): void {
    this.error = error;
    this.onerror?.();
  }
}

/** Run after the current task so handlers assigned by the caller are in place. */
function defer(fn: () => void): void {
  setTimeout(fn, 0);
}

function domError(message: string): DOMException {
  return new DOMException(message, 'InvalidStateError');
}

class FakeObjectStore {
  put(value: Draft): FakeRequest<string> {
    const req = new FakeRequest<string>();
    defer(() => {
      if (failures.put) {
        req.fail(domError('put failed'));
        return;
      }
      records.set(value.key, value);
      req.succeed(value.key);
    });
    return req;
  }

  get(key: string): FakeRequest<Draft> {
    const req = new FakeRequest<Draft>();
    defer(() => {
      if (failures.get) {
        req.fail(domError('get failed'));
        return;
      }
      req.succeed(records.get(key));
    });
    return req;
  }

  getAll(): FakeRequest<Draft[]> {
    const req = new FakeRequest<Draft[]>();
    defer(() => {
      if (failures.getAll) {
        req.fail(domError('getAll failed'));
        return;
      }
      req.succeed(failures.getAllUndefined ? undefined : [...records.values()]);
    });
    return req;
  }

  delete(key: string): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    defer(() => {
      if (failures.delete) {
        req.fail(domError('delete failed'));
        return;
      }
      records.delete(key);
      req.succeed(undefined);
    });
    return req;
  }
}

interface FakeDatabase {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string, options: { keyPath: string }) => void;
  transaction: (name: string, mode: string) => { objectStore: (name: string) => FakeObjectStore };
  close: () => void;
}

const fakeDb: FakeDatabase = {
  objectStoreNames: { contains: (name) => existingStores.has(name) },
  createObjectStore: (name) => {
    existingStores.add(name);
  },
  transaction: () => ({ objectStore: () => new FakeObjectStore() }),
  close: () => {
    closeCount += 1;
  },
};

const fakeIndexedDB = {
  open(): FakeRequest<FakeDatabase> {
    const req = new FakeRequest<FakeDatabase>();
    defer(() => {
      if (failures.open) {
        req.fail(failures.openWithNullError ? null : domError('open failed'));
        return;
      }
      // The module reads `req.result` inside onupgradeneeded, so it must be
      // populated before the upgrade callback runs.
      req.result = fakeDb;
      if (!existingStores.has(STORE_NAME)) {
        req.onupgradeneeded?.();
      }
      req.succeed(fakeDb);
    });
    return req;
  },
};

function installIndexedDB(): void {
  vi.stubGlobal('indexedDB', fakeIndexedDB as unknown as IDBFactory);
}

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

beforeEach(() => {
  records = new Map<string, Draft>();
  existingStores = new Set<string>();
  closeCount = 0;
  failures.open = false;
  failures.openWithNullError = false;
  failures.put = false;
  failures.getAll = false;
  failures.getAllUndefined = false;
  failures.get = false;
  failures.delete = false;
  setOnline(true);
  installIndexedDB();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isAvailable', () => {
  it('is true when the runtime exposes indexedDB', () => {
    expect(isAvailable()).toBe(true);
  });

  it('is false when indexedDB is missing (SSR / Safari private mode)', () => {
    vi.unstubAllGlobals();
    expect(isAvailable()).toBe(false);
  });
});

describe('saveDraft', () => {
  it('persists the payload under the key and stamps createdAt', async () => {
    vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
    await saveDraft('draft-1', { title: 'Vintage lamp' });
    vi.useRealTimers();

    const stored = records.get('draft-1');
    expect(stored?.data).toEqual({ title: 'Vintage lamp' });
    expect(stored?.createdAt).toBe(Date.parse('2026-05-01T00:00:00Z'));
    // The connection must not be leaked once the write settles.
    expect(closeCount).toBe(1);
  });

  it('creates the object store on first open, then reuses it', async () => {
    await saveDraft('draft-1', { a: 1 });
    expect(existingStores.has(STORE_NAME)).toBe(true);

    // Second call takes the "store already exists" arm of onupgradeneeded.
    await saveDraft('draft-2', { a: 2 });
    expect(records.size).toBe(2);
  });

  it('overwrites an existing draft at the same key', async () => {
    await saveDraft('draft-1', { title: 'first' });
    await saveDraft('draft-1', { title: 'second' });

    expect(records.size).toBe(1);
    expect(records.get('draft-1')?.data).toEqual({ title: 'second' });
  });

  it('is a no-op when IndexedDB is unavailable', async () => {
    vi.unstubAllGlobals();
    await expect(saveDraft('draft-1', { a: 1 })).resolves.toBeUndefined();
    expect(records.size).toBe(0);
  });

  it('rejects when the write fails', async () => {
    failures.put = true;
    await expect(saveDraft('draft-1', { a: 1 })).rejects.toThrow('put failed');
  });

  it('rejects when the database cannot be opened', async () => {
    failures.open = true;
    await expect(saveDraft('draft-1', { a: 1 })).rejects.toThrow('open failed');
  });

  it('rejects with a synthetic error when open fails without an error object', async () => {
    failures.open = true;
    failures.openWithNullError = true;
    await expect(saveDraft('draft-1', { a: 1 })).rejects.toThrow('IndexedDB open failed');
  });
});

describe('listDrafts', () => {
  it('returns drafts most-recent first', async () => {
    records.set('old', { key: 'old', data: { n: 1 }, createdAt: 100 });
    records.set('new', { key: 'new', data: { n: 2 }, createdAt: 300 });
    records.set('mid', { key: 'mid', data: { n: 3 }, createdAt: 200 });

    const drafts = await listDrafts();
    expect(drafts.map((d) => d.key)).toEqual(['new', 'mid', 'old']);
  });

  it('returns an empty array when IndexedDB is unavailable', async () => {
    vi.unstubAllGlobals();
    await expect(listDrafts()).resolves.toEqual([]);
  });

  it('returns an empty array when the store yields no result', async () => {
    failures.getAllUndefined = true;
    await expect(listDrafts()).resolves.toEqual([]);
  });

  it('rejects when the read fails', async () => {
    failures.getAll = true;
    await expect(listDrafts()).rejects.toThrow('getAll failed');
  });
});

describe('removeDraft', () => {
  it('deletes the entry at the key', async () => {
    records.set('draft-1', { key: 'draft-1', data: {}, createdAt: 1 });
    records.set('draft-2', { key: 'draft-2', data: {}, createdAt: 2 });

    await removeDraft('draft-1');

    expect([...records.keys()]).toEqual(['draft-2']);
  });

  it('is a no-op for a missing key', async () => {
    await expect(removeDraft('nope')).resolves.toBeUndefined();
    expect(records.size).toBe(0);
  });

  it('is a no-op when IndexedDB is unavailable', async () => {
    vi.unstubAllGlobals();
    await expect(removeDraft('draft-1')).resolves.toBeUndefined();
  });

  it('rejects when the delete fails', async () => {
    failures.delete = true;
    await expect(removeDraft('draft-1')).rejects.toThrow('delete failed');
  });
});

describe('syncDraftsToServer', () => {
  function apiDouble(post: SyncableAPI['post']): SyncableAPI {
    return { post };
  }

  it('POSTs each draft and removes the ones that succeed', async () => {
    records.set('a', { key: 'a', data: { title: 'A' }, createdAt: 2 });
    records.set('b', { key: 'b', data: { title: 'B' }, createdAt: 1 });
    const post = vi.fn().mockResolvedValue({ id: 'listing-1' });

    const result = await syncDraftsToServer(apiDouble(post));

    expect(result).toEqual({ synced: 2, failed: 0 });
    // Most-recent-first ordering from listDrafts is preserved on the wire.
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/listings', { title: 'A' });
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/listings', { title: 'B' });
    expect(records.size).toBe(0);
  });

  it('honours a custom endpoint', async () => {
    records.set('a', { key: 'a', data: { title: 'A' }, createdAt: 1 });
    const post = vi.fn().mockResolvedValue({});

    await syncDraftsToServer(apiDouble(post), '/api/v1/jobs');

    expect(post).toHaveBeenCalledWith('/api/v1/jobs', { title: 'A' });
  });

  it('keeps a failed draft and stamps the error on it for retry', async () => {
    records.set('a', { key: 'a', data: { title: 'A' }, createdAt: 1 });
    const post = vi.fn().mockRejectedValue(new Error('422 unprocessable'));

    const result = await syncDraftsToServer(apiDouble(post));

    expect(result).toEqual({ synced: 0, failed: 1 });
    const kept = records.get('a');
    expect(kept?.lastError).toBe('422 unprocessable');
    expect(typeof kept?.lastSyncAttempt).toBe('number');
    // createdAt must survive the error stamp — it is immutable after save.
    expect(kept?.createdAt).toBe(1);
  });

  it('records a generic message when the thrown value is not an Error', async () => {
    records.set('a', { key: 'a', data: { title: 'A' }, createdAt: 1 });
    const post = vi.fn().mockRejectedValue('kaboom');

    const result = await syncDraftsToServer(apiDouble(post));

    expect(result).toEqual({ synced: 0, failed: 1 });
    expect(records.get('a')?.lastError).toBe('sync failed');
  });

  it('reports mixed success and failure counts', async () => {
    records.set('ok', { key: 'ok', data: { title: 'ok' }, createdAt: 2 });
    records.set('bad', { key: 'bad', data: { title: 'bad' }, createdAt: 1 });
    const post = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('nope'));

    const result = await syncDraftsToServer(apiDouble(post));

    expect(result).toEqual({ synced: 1, failed: 1 });
    expect(records.has('ok')).toBe(false);
    expect(records.get('bad')?.lastError).toBe('nope');
  });

  it('does nothing while the browser is offline', async () => {
    setOnline(false);
    records.set('a', { key: 'a', data: {}, createdAt: 1 });
    const post = vi.fn();

    await expect(syncDraftsToServer(apiDouble(post))).resolves.toEqual({
      synced: 0,
      failed: 0,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('does nothing when IndexedDB is unavailable', async () => {
    vi.unstubAllGlobals();
    const post = vi.fn();

    await expect(syncDraftsToServer(apiDouble(post))).resolves.toEqual({
      synced: 0,
      failed: 0,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('swallows a failed error-stamp so one bad draft cannot abort the run', async () => {
    records.set('a', { key: 'a', data: {}, createdAt: 2 });
    records.set('b', { key: 'b', data: {}, createdAt: 1 });
    failures.get = true; // markDraftError's read fails
    const post = vi.fn().mockRejectedValue(new Error('down'));

    const result = await syncDraftsToServer(apiDouble(post));

    expect(result).toEqual({ synced: 0, failed: 2 });
  });

  it('skips the error stamp when the draft is already gone', async () => {
    records.set('a', { key: 'a', data: {}, createdAt: 1 });
    const post = vi.fn().mockImplementation(() => {
      // Another tab removed the draft between the read and the failure.
      records.delete('a');
      return Promise.reject(new Error('down'));
    });

    const result = await syncDraftsToServer(apiDouble(post));

    expect(result).toEqual({ synced: 0, failed: 1 });
    expect(records.size).toBe(0);
  });

  it('swallows a failed error-stamp write', async () => {
    records.set('a', { key: 'a', data: {}, createdAt: 1 });
    failures.put = true; // markDraftError's write fails
    const post = vi.fn().mockRejectedValue(new Error('down'));

    await expect(syncDraftsToServer(apiDouble(post))).resolves.toEqual({
      synced: 0,
      failed: 1,
    });
  });
});

describe('registerAutoSync', () => {
  it('syncs when the browser comes back online and stops after unsubscribe', async () => {
    records.set('a', { key: 'a', data: { title: 'A' }, createdAt: 1 });
    const post = vi.fn().mockResolvedValue({});

    const unsubscribe = registerAutoSync({ post });

    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/v1/listings', { title: 'A' });
    });

    unsubscribe();
    records.set('b', { key: 'b', data: { title: 'B' }, createdAt: 2 });
    window.dispatchEvent(new Event('online'));
    // Give the (now detached) handler a chance to run before asserting.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('passes the custom endpoint through to the sync', async () => {
    records.set('a', { key: 'a', data: { title: 'A' }, createdAt: 1 });
    const post = vi.fn().mockResolvedValue({});

    const unsubscribe = registerAutoSync({ post }, '/api/v1/jobs');
    window.dispatchEvent(new Event('online'));

    await vi.waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/v1/jobs', { title: 'A' });
    });
    unsubscribe();
  });
});
