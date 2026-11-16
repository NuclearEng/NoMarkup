// offline-drafts — request failures that carry no error object (fallback
// messages), an upgrade against a database that already has the store,
// IndexedDB disappearing mid-sync, a non-Error sync failure, and the
// server-side (no window) auto-sync registration.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Draft,
  type SyncableAPI,
  listDrafts,
  registerAutoSync,
  removeDraft,
  saveDraft,
  syncDraftsToServer,
} from '@/lib/offline-drafts';

type Operation = 'put' | 'getAll' | 'delete';

interface FakeRequest {
  result: unknown;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}

const idb = {
  records: new Map<string, Draft>(),
  /** Operations whose request fails with `error === null`. */
  failWithNullError: new Set<Operation>(),
  storeAlreadyExists: false,
  createObjectStore: vi.fn(),
  close: vi.fn(),
};

/** Settle on a microtask, after the caller has attached its handlers. */
function request(settle: (req: FakeRequest) => void): FakeRequest {
  const req: FakeRequest = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  queueMicrotask(() => {
    settle(req);
  });
  return req;
}

function operation(name: Operation, apply: (req: FakeRequest) => void): FakeRequest {
  return request((req) => {
    if (idb.failWithNullError.has(name)) {
      req.onerror?.();
      return;
    }
    apply(req);
    req.onsuccess?.();
  });
}

const store = {
  put: (draft: Draft) =>
    operation('put', () => {
      idb.records.set(draft.key, draft);
    }),
  getAll: () =>
    operation('getAll', (req) => {
      req.result = [...idb.records.values()];
    }),
  get: (key: string) =>
    request((req) => {
      req.result = idb.records.get(key);
      req.onsuccess?.();
    }),
  delete: (key: string) =>
    operation('delete', () => {
      idb.records.delete(key);
    }),
};

const database = {
  objectStoreNames: { contains: () => idb.storeAlreadyExists },
  createObjectStore: idb.createObjectStore,
  transaction: () => ({ objectStore: () => store }),
  close: idb.close,
};

function installIndexedDB(): void {
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: {
      open: () =>
        request((req) => {
          req.result = database;
          req.onupgradeneeded?.();
          req.onsuccess?.();
        }),
    },
  });
}

function removeIndexedDB(): void {
  Reflect.deleteProperty(window, 'indexedDB');
}

function syncApi(post: (path: string, body?: unknown) => Promise<unknown>): SyncableAPI {
  return { post: <R>(path: string, body?: unknown) => post(path, body) as Promise<R> };
}

function draft(key: string, createdAt: number): Draft {
  return { key, data: { title: key }, createdAt };
}

beforeEach(() => {
  idb.records.clear();
  idb.failWithNullError.clear();
  idb.storeAlreadyExists = false;
  vi.clearAllMocks();
  installIndexedDB();
});

afterEach(() => {
  removeIndexedDB();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('opening the database', () => {
  it('creates the drafts store keyed by `key` on first open', async () => {
    await saveDraft('d-1', { title: 'Sofa' });

    expect(idb.createObjectStore).toHaveBeenCalledWith('drafts', { keyPath: 'key' });
  });

  it('does not recreate the store when an upgrade finds it already there', async () => {
    idb.storeAlreadyExists = true;

    await saveDraft('d-1', { title: 'Sofa' });

    expect(idb.createObjectStore).not.toHaveBeenCalled();
    expect(idb.records.get('d-1')?.data).toEqual({ title: 'Sofa' });
    expect(idb.close).toHaveBeenCalledTimes(1);
  });
});

describe('request failures with no error object', () => {
  it('saveDraft rejects with a named fallback and stores nothing', async () => {
    idb.failWithNullError.add('put');

    await expect(saveDraft('d-1', {})).rejects.toThrow('saveDraft failed');
    expect(idb.records.size).toBe(0);
  });

  it('listDrafts rejects with a named fallback', async () => {
    idb.failWithNullError.add('getAll');

    await expect(listDrafts()).rejects.toThrow('listDrafts failed');
  });

  it('removeDraft rejects with a named fallback and keeps the draft', async () => {
    idb.records.set('d-1', draft('d-1', 1));
    idb.failWithNullError.add('delete');

    await expect(removeDraft('d-1')).rejects.toThrow('removeDraft failed');
    expect(idb.records.has('d-1')).toBe(true);
  });
});

describe('syncDraftsToServer', () => {
  it('posts drafts newest first to the given endpoint and removes the ones that succeed', async () => {
    idb.records.set('old', draft('old', 100));
    idb.records.set('new', draft('new', 200));
    const post = vi.fn<(path: string, body?: unknown) => Promise<unknown>>().mockResolvedValue({});

    const result = await syncDraftsToServer(syncApi(post), '/api/v1/jobs');

    expect(post.mock.calls).toEqual([
      ['/api/v1/jobs', { title: 'new' }],
      ['/api/v1/jobs', { title: 'old' }],
    ]);
    expect(result).toEqual({ synced: 2, failed: 0 });
    expect(idb.records.size).toBe(0);
  });

  it('records "sync failed" on the draft when the rejection is not an Error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    idb.records.set('d-1', draft('d-1', 100));
    const post = vi.fn<(path: string, body?: unknown) => Promise<unknown>>().mockRejectedValue('offline');

    const result = await syncDraftsToServer(syncApi(post));
    vi.useRealTimers();

    expect(post).toHaveBeenCalledWith('/api/v1/listings', { title: 'd-1' });
    expect(result).toEqual({ synced: 0, failed: 1 });
    expect(idb.records.get('d-1')).toEqual({
      ...draft('d-1', 100),
      lastSyncAttempt: Date.parse('2026-03-01T12:00:00Z'),
      lastError: 'sync failed',
    });
  });

  it('still reports the failure when IndexedDB goes away before the error can be recorded', async () => {
    idb.records.set('d-1', draft('d-1', 100));
    const post = vi.fn<(path: string, body?: unknown) => Promise<unknown>>().mockImplementation(() => {
      removeIndexedDB();
      return Promise.reject(new Error('500'));
    });

    const result = await syncDraftsToServer(syncApi(post));

    expect(result).toEqual({ synced: 0, failed: 1 });
    // Nothing could be written back: the draft is unchanged.
    expect(idb.records.get('d-1')).toEqual(draft('d-1', 100));
  });

  it('does nothing while the browser reports it is offline', async () => {
    idb.records.set('d-1', draft('d-1', 100));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const post = vi.fn<(path: string, body?: unknown) => Promise<unknown>>();

    const result = await syncDraftsToServer(syncApi(post));

    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(post).not.toHaveBeenCalled();
    expect(idb.records.size).toBe(1);
  });
});

describe('registerAutoSync', () => {
  it('syncs to the given endpoint on `online` and stops after the returned cleanup runs', async () => {
    idb.records.set('d-1', draft('d-1', 100));
    const post = vi.fn<(path: string, body?: unknown) => Promise<unknown>>().mockResolvedValue({});
    const stop = registerAutoSync(syncApi(post), '/api/v1/jobs');

    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => {
      expect(idb.records.size).toBe(0);
    });
    expect(post).toHaveBeenCalledWith('/api/v1/jobs', { title: 'd-1' });

    stop();
    idb.records.set('d-2', draft('d-2', 200));
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('registers nothing on the server (no window) and returns a harmless cleanup', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const post = vi.fn<(path: string, body?: unknown) => Promise<unknown>>();
    vi.stubGlobal('window', undefined);

    const stop = registerAutoSync(syncApi(post));
    stop();
    vi.unstubAllGlobals();

    expect(addListener).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
