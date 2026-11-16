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

  // The list used to restart from the (empty) stored list on every pick, so it
  // only ever held the newest market.
  it('keeps earlier picks when more are added, newest first and deduped', () => {
    refuseWrites = true;
    const picker = renderHook(() => useRecentMarkets());
    const header = renderHook(() => useRecentMarkets());

    act(() => {
      picker.result.current[1](market('boise'));
    });
    act(() => {
      picker.result.current[1](market('reno'));
    });
    act(() => {
      header.result.current[1](market('boise'));
    });

    expect(store.size).toBe(0);
    expect(picker.result.current[0]).toEqual([market('boise'), market('reno')]);
    expect(header.result.current[0]).toEqual([market('boise'), market('reno')]);
  });

  it('caps the in-memory list at five', () => {
    refuseWrites = true;
    const { result } = renderHook(() => useRecentMarkets());

    for (const slug of ['a', 'b', 'c', 'd', 'e', 'f']) {
      act(() => {
        result.current[1](market(slug));
      });
    }

    expect(result.current[0].map((m) => m.slug)).toEqual(['f', 'e', 'd', 'c', 'b']);
  });

  it('goes back to storage as the source once a write succeeds', () => {
    refuseWrites = true;
    const { result } = renderHook(() => useRecentMarkets());
    act(() => {
      result.current[1](market('boise'));
    });

    refuseWrites = false;
    act(() => {
      result.current[1](market('reno'));
    });

    expect(JSON.parse(store.get('nm.recentMarkets') ?? '[]')).toEqual([
      market('reno'),
      market('boise'),
    ]);
    expect(result.current[0]).toEqual([market('reno'), market('boise')]);

    // Another tab rewrites storage; the stale in-memory copy must not win.
    store.set('nm.recentMarkets', JSON.stringify([market('tahoe')]));
    act(() => {
      window.dispatchEvent(new Event('storage'));
    });
    expect(result.current[0]).toEqual([market('tahoe')]);
  });

  // Clearing the selected market succeeds even when storage refuses new
  // values (removeItem does not throw on a full or private store). That write
  // must not send the recents list back to the empty stored copy.
  it('keeps the in-memory list when the selected market is cleared', () => {
    const selected = renderHook(() => useSelectedMarket());
    const recents = renderHook(() => useRecentMarkets());
    const removeItem = storage.removeItem;
    storage.removeItem = (key: string) => {
      store.delete(key);
    };
    refuseWrites = true;

    act(() => {
      recents.result.current[1](market('boise'));
      recents.result.current[1](market('reno'));
    });
    act(() => {
      selected.result.current[1](null);
    });
    act(() => {
      recents.result.current[1](market('tahoe'));
    });
    storage.removeItem = removeItem;

    expect(recents.result.current[0].map((m) => m.slug)).toEqual(['tahoe', 'reno', 'boise']);
  });
});
