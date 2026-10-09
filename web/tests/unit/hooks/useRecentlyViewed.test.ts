import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  useRecentlyViewed,
  useRecordRecentView,
} from '@/hooks/useRecentlyViewed';

const STORAGE_KEY = 'nm:recently-viewed';

// jsdom's Storage stub on this project's vitest doesn't expose the prototype
// methods as functions — install a minimal in-memory shim. Pattern lifted
// from tests/unit/app/dashboard/admin-platform.test.tsx.
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length(): number {
        return store.size;
      },
    },
  });
});

function readRaw(): unknown {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('useRecentlyViewed', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns an empty list when nothing is in storage', () => {
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toEqual([]);
  });

  it('records a viewed listing on mount via useRecordRecentView', () => {
    renderHook(() => { useRecordRecentView('listing-A'); });
    const stored = readRaw() as Array<{ id: string; visitedAt: string }>;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe('listing-A');
    expect(typeof stored[0]?.visitedAt).toBe('string');
  });

  it('moves a re-viewed listing to the front instead of duplicating', () => {
    // Seed two entries, with listing-A being older
    const olderTimestamp = new Date(Date.now() - 60_000).toISOString();
    const newerTimestamp = new Date(Date.now() - 30_000).toISOString();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'listing-B', visitedAt: newerTimestamp },
        { id: 'listing-A', visitedAt: olderTimestamp },
      ]),
    );

    renderHook(() => { useRecordRecentView('listing-A'); });

    const stored = readRaw() as Array<{ id: string; visitedAt: string }>;
    expect(stored).toHaveLength(2);
    // listing-A moves to front, listing-B drops to second
    expect(stored[0]?.id).toBe('listing-A');
    expect(stored[1]?.id).toBe('listing-B');
  });

  it('caps storage at 12 entries (FIFO eviction of the oldest)', () => {
    // Seed 12 entries
    const seed = Array.from({ length: 12 }, (_, i) => ({
      id: `seed-${String(i)}`,
      visitedAt: new Date(Date.now() - (12 - i) * 1000).toISOString(),
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));

    // Add a 13th — the oldest (seed-0 sorts last in our chronological order
    // but the hook unshifts a new entry to position 0 then slices the tail)
    renderHook(() => { useRecordRecentView('new-entry'); });

    const stored = readRaw() as Array<{ id: string; visitedAt: string }>;
    expect(stored).toHaveLength(12);
    // newest is at the front
    expect(stored[0]?.id).toBe('new-entry');
    // the very last seed entry (lowest priority) should have been evicted
    const ids = stored.map((s) => s.id);
    // exactly 11 of the original seeds plus the new entry survive
    expect(ids.filter((id) => id.startsWith('seed-'))).toHaveLength(11);
  });

  it('keeps newest-first ordering across multiple inserts', () => {
    renderHook(() => { useRecordRecentView('first'); });
    renderHook(() => { useRecordRecentView('second'); });
    renderHook(() => { useRecordRecentView('third'); });

    const stored = readRaw() as Array<{ id: string; visitedAt: string }>;
    expect(stored.map((s) => s.id)).toEqual(['third', 'second', 'first']);
  });

  it('exposes a clear() that empties storage', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'x', visitedAt: new Date().toISOString() }]),
    );
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toHaveLength(1);
    act(() => {
      result.current.clear();
    });
    expect(result.current.entries).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify([]));
  });
});
