// useRecentlyViewed — the paths useRecentlyViewed.test.ts leaves out: bad
// values in storage, the cross-tab `storage` event, storage that refuses
// writes, the empty-id guard, and the listing fetch (`useRecentlyViewedListings`).
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useRecentlyViewed,
  useRecentlyViewedListings,
  useRecordRecentView,
} from '@/hooks/useRecentlyViewed';

import { type MemoryStorage, installMemoryStorage } from '../_gaps-memory-storage';

const mocks = vi.hoisted(() => ({
  getPublic: vi.fn<(path: string) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', () => ({
  api: { getPublic: mocks.getPublic },
}));

const STORAGE_KEY = 'nm:recently-viewed';

let queryClient: QueryClient;
let storage: MemoryStorage;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function seed(value: unknown): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function entry(id: string) {
  return { id, visitedAt: '2026-01-01T00:00:00.000Z' };
}

beforeEach(() => {
  storage = installMemoryStorage();
  mocks.getPublic.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

describe('useRecentlyViewed — reading bad storage', () => {
  it('treats a JSON value that is not an array as empty', () => {
    seed({ id: 'l-1', visitedAt: 'x' });
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toEqual([]);
  });

  it('treats corrupt JSON as empty', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toEqual([]);
  });

  it('keeps only well-formed entries and strips extra fields', () => {
    seed([
      null,
      42,
      'l-0',
      { id: 7, visitedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'l-no-date' },
      { ...entry('l-ok'), title: 'leaked field' },
    ]);
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toEqual([entry('l-ok')]);
  });
});

describe('useRecentlyViewed — cross-tab sync', () => {
  it('re-reads storage when another tab changes the recently-viewed key', () => {
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toEqual([]);

    seed([entry('l-from-other-tab')]);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    expect(result.current.entries).toEqual([entry('l-from-other-tab')]);
  });

  it('ignores storage events for other keys', () => {
    const { result } = renderHook(() => useRecentlyViewed());
    seed([entry('l-unseen')]);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'nm.selectedMarket' }));
    });
    expect(result.current.entries).toEqual([]);
  });

  it('stops listening after unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useRecentlyViewed());
    unmount();
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
  });
});

describe('useRecentlyViewed — storage that refuses writes', () => {
  it('clear() still empties the in-memory list when setItem throws', () => {
    seed([entry('l-1')]);
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toHaveLength(1);

    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.entries).toEqual([]);
  });

  it('useRecordRecentView swallows a quota error and leaves storage unchanged', () => {
    seed([entry('l-1')]);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    renderHook(() => {
      useRecordRecentView('l-2');
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify([entry('l-1')]));
  });
});

describe('useRecordRecentView — id guard', () => {
  it.each([undefined, ''])('writes nothing for id %j', (id) => {
    const setItem = vi.spyOn(storage, 'setItem');
    renderHook(() => {
      useRecordRecentView(id);
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('records the new id once the id becomes available', () => {
    const { rerender } = renderHook(
      ({ id }: { id: string | undefined }) => {
        useRecordRecentView(id);
      },
      { initialProps: { id: undefined as string | undefined } },
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    rerender({ id: 'l-late' });
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as { id: string }[];
    expect(stored.map((e) => e.id)).toEqual(['l-late']);
  });
});

describe('useRecentlyViewedListings', () => {
  it('fetches nothing and is not loading when storage is empty', () => {
    const { result } = renderHook(() => useRecentlyViewedListings(), { wrapper });
    expect(result.current).toEqual({ listings: [], isLoading: false });
    expect(mocks.getPublic).not.toHaveBeenCalled();
  });

  it('fetches only the first 6 ids by default, newest first', async () => {
    seed(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(entry));
    mocks.getPublic.mockImplementation((path) =>
      Promise.resolve({ listing: { id: path.replace('/api/v1/listings/', ''), photos: [] } }),
    );

    const { result } = renderHook(() => useRecentlyViewedListings(), { wrapper });

    await waitFor(() => {
      expect(result.current.listings).toHaveLength(6);
    });
    expect(mocks.getPublic.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/listings/a',
      '/api/v1/listings/b',
      '/api/v1/listings/c',
      '/api/v1/listings/d',
      '/api/v1/listings/e',
      '/api/v1/listings/f',
    ]);
    expect(result.current.listings.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(result.current.isLoading).toBe(false);
  });

  it('honours an explicit limit', async () => {
    seed(['a', 'b', 'c'].map(entry));
    mocks.getPublic.mockResolvedValue({ listing: { id: 'x', photos: [] } });

    const { result } = renderHook(() => useRecentlyViewedListings(2), { wrapper });

    await waitFor(() => {
      expect(result.current.listings).toHaveLength(2);
    });
    expect(mocks.getPublic).toHaveBeenCalledTimes(2);
  });

  it('normalizes `photos: null` and a missing `photos` to an empty array, and keeps real photos', async () => {
    seed(['null-photos', 'no-photos', 'with-photos'].map(entry));
    const photo = { id: 'p-1', url: 'https://cdn.example/p-1.webp' };
    const byPath: Record<string, unknown> = {
      '/api/v1/listings/null-photos': { listing: { id: 'null-photos', photos: null } },
      '/api/v1/listings/no-photos': { listing: { id: 'no-photos' } },
      '/api/v1/listings/with-photos': { listing: { id: 'with-photos', photos: [photo] } },
    };
    mocks.getPublic.mockImplementation((path) => Promise.resolve(byPath[path]));

    const { result } = renderHook(() => useRecentlyViewedListings(), { wrapper });

    await waitFor(() => {
      expect(result.current.listings).toHaveLength(3);
    });
    expect(result.current.listings.map((l) => l.photos)).toEqual([[], [], [photo]]);
  });

  it('shares the ["listings", id] cache key with the listing detail page', async () => {
    seed([entry('l-9')]);
    mocks.getPublic.mockResolvedValue({ listing: { id: 'l-9', photos: null } });

    const { result } = renderHook(() => useRecentlyViewedListings(), { wrapper });

    await waitFor(() => {
      expect(result.current.listings).toHaveLength(1);
    });
    expect(queryClient.getQueryData(['listings', 'l-9'])).toEqual({ id: 'l-9', photos: [] });
  });

  it('reports loading while requests are in flight and drops listings that fail (no retry)', async () => {
    seed(['gone', 'ok'].map(entry));
    let deliver: (value: unknown) => void = () => undefined;
    const pending = new Promise<unknown>((resolve) => {
      deliver = resolve;
    });
    mocks.getPublic.mockImplementation((path) =>
      path.endsWith('/gone') ? Promise.reject(new Error('404')) : pending,
    );

    const { result } = renderHook(() => useRecentlyViewedListings(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.listings).toEqual([]);

    deliver({ listing: { id: 'ok', photos: [] } });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.listings.map((l) => l.id)).toEqual(['ok']);
    // `retry: false` on the query: the failed id is requested exactly once.
    expect(mocks.getPublic.mock.calls.filter((c) => c[0] === '/api/v1/listings/gone')).toHaveLength(1);
  });
});
