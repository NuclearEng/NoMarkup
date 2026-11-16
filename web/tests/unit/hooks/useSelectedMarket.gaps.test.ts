// useSelectedMarket / useRecentMarkets — localStorage-backed "current city".
// Covers hydration, same-tab and cross-tab sync, clearing, corrupt storage,
// storage that refuses writes, recents ordering / dedupe / cap, and the
// no-window (server) guard on the setters.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecentMarkets, useSelectedMarket } from '@/hooks/useSelectedMarket';
import type { Market } from '@/types';

import { type MemoryStorage, installMemoryStorage } from '../_gaps-memory-storage';

const SELECTED_KEY = 'nm.selectedMarket';
const RECENTS_KEY = 'nm.recentMarkets';
const EVENT = 'nm:selectedMarket';

function market(slug: string): Market {
  return {
    id: `id-${slug}`,
    slug,
    name: slug.toUpperCase(),
    region: 'California',
    region_code: 'CA',
    country: 'US',
    is_active: true,
    lat: null,
    lng: null,
  };
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = installMemoryStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useSelectedMarket', () => {
  it('is null when nothing is stored', () => {
    const { result } = renderHook(() => useSelectedMarket());
    expect(result.current[0]).toBeNull();
  });

  it('hydrates from storage after mount', () => {
    storage.setItem(SELECTED_KEY, JSON.stringify(market('sfbay')));
    const { result } = renderHook(() => useSelectedMarket());
    expect(result.current[0]).toEqual(market('sfbay'));
  });

  it('treats corrupt JSON as no selection', () => {
    storage.setItem(SELECTED_KEY, '{"slug":');
    const { result } = renderHook(() => useSelectedMarket());
    expect(result.current[0]).toBeNull();
  });

  it('persists a selection and announces it to other consumers in the tab', () => {
    const heard = vi.fn();
    window.addEventListener(EVENT, heard);
    const { result } = renderHook(() => useSelectedMarket());

    act(() => {
      result.current[1](market('austin'));
    });

    expect(result.current[0]).toEqual(market('austin'));
    expect(JSON.parse(storage.getItem(SELECTED_KEY) ?? 'null')).toEqual(market('austin'));
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(EVENT, heard);
  });

  it('keeps two consumers in the same tab in sync', () => {
    const a = renderHook(() => useSelectedMarket());
    const b = renderHook(() => useSelectedMarket());

    act(() => {
      a.result.current[1](market('denver'));
    });

    expect(b.result.current[0]).toEqual(market('denver'));
  });

  it('clearing removes the stored value and resets consumers to null', () => {
    storage.setItem(SELECTED_KEY, JSON.stringify(market('sfbay')));
    const a = renderHook(() => useSelectedMarket());
    const b = renderHook(() => useSelectedMarket());
    expect(b.result.current[0]).toEqual(market('sfbay'));

    act(() => {
      a.result.current[1](null);
    });

    expect(storage.getItem(SELECTED_KEY)).toBeNull();
    expect(a.result.current[0]).toBeNull();
    expect(b.result.current[0]).toBeNull();
  });

  it('picks up a change made in another tab via the storage event', () => {
    const { result } = renderHook(() => useSelectedMarket());
    storage.setItem(SELECTED_KEY, JSON.stringify(market('miami')));

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: SELECTED_KEY }));
    });

    expect(result.current[0]).toEqual(market('miami'));
  });

  it('stops listening after unmount', () => {
    const { result, unmount } = renderHook(() => useSelectedMarket());
    unmount();
    storage.setItem(SELECTED_KEY, JSON.stringify(market('miami')));

    act(() => {
      window.dispatchEvent(new Event(EVENT));
    });

    expect(result.current[0]).toBeNull();
  });

  // Source bug (useSelectedMarket.ts:56-60): the catch comment promises an
  // in-memory fallback, but the sync event dispatched on line 60 re-reads the
  // (still empty) storage and overwrites the state that line 59 just set.
  it.todo('keeps the picked market in memory when storage refuses the write');

  it('does not throw when storage refuses the write; the pick is currently lost on the sync re-read', () => {
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { result } = renderHook(() => useSelectedMarket());

    act(() => {
      result.current[1](market('boise'));
    });

    expect(storage.getItem(SELECTED_KEY)).toBeNull();
    expect(result.current[0]).toBeNull();
  });

  it('returns null when reading storage throws', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { result } = renderHook(() => useSelectedMarket());
    expect(result.current[0]).toBeNull();
  });

  it('setter is a no-op without a window (server): nothing stored, nothing dispatched', () => {
    const { result } = renderHook(() => useSelectedMarket());
    const setMarket = result.current[1];
    const dispatch = vi.spyOn(window, 'dispatchEvent');

    vi.stubGlobal('window', undefined);
    setMarket(market('reno'));
    vi.unstubAllGlobals();

    expect(storage.getItem(SELECTED_KEY)).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current[0]).toBeNull();
  });
});

describe('useRecentMarkets', () => {
  it('is empty when nothing is stored', () => {
    const { result } = renderHook(() => useRecentMarkets());
    expect(result.current[0]).toEqual([]);
  });

  it('hydrates the stored list in order', () => {
    storage.setItem(RECENTS_KEY, JSON.stringify([market('a'), market('b')]));
    const { result } = renderHook(() => useRecentMarkets());
    expect(result.current[0].map((m) => m.slug)).toEqual(['a', 'b']);
  });

  it.each([
    ['corrupt JSON', '[{'],
    ['a JSON object instead of an array', JSON.stringify({ slug: 'a' })],
    ['a JSON string', JSON.stringify('a')],
  ])('treats %s as no recents', (_name, raw) => {
    storage.setItem(RECENTS_KEY, raw);
    const { result } = renderHook(() => useRecentMarkets());
    expect(result.current[0]).toEqual([]);
  });

  it('puts the newest pick first and moves a repeat pick to the front without duplicating', () => {
    const { result } = renderHook(() => useRecentMarkets());

    act(() => {
      result.current[1](market('a'));
    });
    act(() => {
      result.current[1](market('b'));
    });
    act(() => {
      result.current[1](market('a'));
    });

    expect(result.current[0].map((m) => m.slug)).toEqual(['a', 'b']);
    const stored = JSON.parse(storage.getItem(RECENTS_KEY) ?? '[]') as Market[];
    expect(stored.map((m) => m.slug)).toEqual(['a', 'b']);
  });

  it('caps the list at 5, dropping the oldest', () => {
    storage.setItem(
      RECENTS_KEY,
      JSON.stringify(['a', 'b', 'c', 'd', 'e'].map(market)),
    );
    const { result } = renderHook(() => useRecentMarkets());

    act(() => {
      result.current[1](market('f'));
    });

    expect(result.current[0].map((m) => m.slug)).toEqual(['f', 'a', 'b', 'c', 'd']);
  });

  it('syncs a second consumer through the shared event', () => {
    const a = renderHook(() => useRecentMarkets());
    const b = renderHook(() => useRecentMarkets());

    act(() => {
      a.result.current[1](market('z'));
    });

    expect(b.result.current[0].map((m) => m.slug)).toEqual(['z']);
  });

  it('re-reads on a cross-tab storage event and stops after unmount', () => {
    const { result, unmount } = renderHook(() => useRecentMarkets());
    storage.setItem(RECENTS_KEY, JSON.stringify([market('x')]));

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY }));
    });
    expect(result.current[0].map((m) => m.slug)).toEqual(['x']);

    unmount();
    storage.setItem(RECENTS_KEY, JSON.stringify([market('y')]));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY }));
    });
    expect(result.current[0].map((m) => m.slug)).toEqual(['x']);
  });

  // Same source bug as above (useSelectedMarket.ts:105-109).
  it.todo('keeps the new recents list in memory when storage refuses the write');

  it('does not throw when storage refuses the write; the list is currently lost on the sync re-read', () => {
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useRecentMarkets());

    act(() => {
      result.current[1](market('q'));
    });

    expect(storage.getItem(RECENTS_KEY)).toBeNull();
    expect(result.current[0]).toEqual([]);
  });

  it('pushRecent is a no-op without a window (server)', () => {
    const { result } = renderHook(() => useRecentMarkets());
    const pushRecent = result.current[1];

    vi.stubGlobal('window', undefined);
    pushRecent(market('reno'));
    vi.unstubAllGlobals();

    expect(storage.getItem(RECENTS_KEY)).toBeNull();
    expect(result.current[0]).toEqual([]);
  });
});
