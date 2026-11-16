// useSelectedMarket / useRecentMarkets — when localStorage refuses the write
// the pick must survive in memory. It used to be wiped at once: the sync event
// fired after the write re-read the (still empty) storage.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecentMarkets, useSelectedMarket } from '@/hooks/useSelectedMarket';
import type { Market } from '@/types';

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

const store = new Map<string, string>();
let refuseWrites = false;

const storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (refuseWrites) throw new Error('QuotaExceededError');
    store.set(key, value);
  },
  removeItem: (key: string) => {
    if (refuseWrites) throw new Error('SecurityError');
    store.delete(key);
  },
};

beforeEach(() => {
  store.clear();
  refuseWrites = false;
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSelectedMarket when storage refuses the write', () => {
  it('keeps the picked market in memory', () => {
    refuseWrites = true;
    const { result } = renderHook(() => useSelectedMarket());

    act(() => {
      result.current[1](market('boise'));
    });

    expect(store.size).toBe(0);
    expect(result.current[0]).toEqual(market('boise'));
  });

  it('shares the in-memory pick with other consumers in the tab', () => {
    refuseWrites = true;
    const picker = renderHook(() => useSelectedMarket());
    const header = renderHook(() => useSelectedMarket());

    act(() => {
      picker.result.current[1](market('boise'));
    });

    expect(header.result.current[0]).toEqual(market('boise'));
  });

  it('keeps the pick when the recents list is updated right after', () => {
    refuseWrites = true;
    const selected = renderHook(() => useSelectedMarket());
    const recents = renderHook(() => useRecentMarkets());

    act(() => {
      selected.result.current[1](market('boise'));
      recents.result.current[1](market('boise'));
    });

    expect(selected.result.current[0]).toEqual(market('boise'));
    expect(recents.result.current[0]).toEqual([market('boise')]);
  });

  it('clears an in-memory pick when asked to', () => {
    refuseWrites = true;
    const { result } = renderHook(() => useSelectedMarket());
    act(() => {
      result.current[1](market('boise'));
    });

    act(() => {
      result.current[1](null);
    });

    expect(result.current[0]).toBeNull();
  });

  it('still persists and re-reads storage when the write works', () => {
    const picker = renderHook(() => useSelectedMarket());
    const header = renderHook(() => useSelectedMarket());

    act(() => {
      picker.result.current[1](market('reno'));
    });

    expect(JSON.parse(store.get('nm.selectedMarket') ?? 'null')).toEqual(market('reno'));
    expect(header.result.current[0]).toEqual(market('reno'));
  });
});

describe('useRecentMarkets when storage refuses the write', () => {
  it('keeps the new recents list in memory and shares it', () => {
    refuseWrites = true;
    const first = renderHook(() => useRecentMarkets());
    const second = renderHook(() => useRecentMarkets());

    act(() => {
      first.result.current[1](market('boise'));
    });

    expect(store.size).toBe(0);
    expect(first.result.current[0]).toEqual([market('boise')]);
    expect(second.result.current[0]).toEqual([market('boise')]);
  });
});
