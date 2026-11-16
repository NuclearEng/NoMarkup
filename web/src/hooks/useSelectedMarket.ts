'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Market } from '@/types';

const STORAGE_KEY = 'nm.selectedMarket';
const RECENTS_KEY = 'nm.recentMarkets';
const RECENTS_MAX = 5;
const EVENT = 'nm:selectedMarket';

/**
 * When localStorage refuses a write (private mode, quota) the value cannot be
 * re-read from storage, so the sync event carries it instead. Listeners take
 * the value for their own key from the event and leave their state alone when
 * the event carries the other key; a plain event means "re-read storage".
 */
interface MemoryFallback {
  selected?: Market | null;
  recents?: Market[];
}

function announce(fallback?: MemoryFallback): void {
  window.dispatchEvent(
    fallback ? new CustomEvent<MemoryFallback>(EVENT, { detail: fallback }) : new Event(EVENT),
  );
}

function fallbackOf(event: Event): MemoryFallback | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  return typeof detail === 'object' && detail !== null ? (detail as MemoryFallback) : null;
}

function read(): Market | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Market) : null;
  } catch {
    return null;
  }
}

/**
 * useSelectedMarket — the app's shared "current city" context, craigslist-style.
 *
 * Backed by localStorage so the choice persists across reloads, with a custom
 * window event so every consumer (header chip, browse filters) stays in sync
 * within the same tab, plus the native `storage` event for cross-tab sync.
 *
 * Note: markets currently have null lat/lng (geocode backfill is a follow-up),
 * so this drives the "where am I" UI context, not yet precise radius filtering.
 * Consumers that need coords should check `market.lat != null` before using them.
 */
export function useSelectedMarket(): [Market | null, (m: Market | null) => void] {
  const [market, setMarketState] = useState<Market | null>(null);

  // Hydrate after mount (avoids SSR/client mismatch).
  useEffect(() => {
    setMarketState(read());
  }, []);

  useEffect(() => {
    const sync = (event: Event) => {
      const fallback = fallbackOf(event);
      if (!fallback) setMarketState(read());
      else if (fallback.selected !== undefined) setMarketState(fallback.selected);
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setMarket = useCallback((m: Market | null) => {
    if (typeof window === 'undefined') return;
    let stored = true;
    try {
      if (m) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable (private mode) — fall back to in-memory only
      stored = false;
    }
    setMarketState(m);
    announce(stored ? undefined : { selected: m });
  }, []);

  return [market, setMarket];
}

function readRecents(): Market[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const arr = raw ? (JSON.parse(raw) as Market[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * useRecentMarkets tracks the last few markets the user picked (most-recent
 * first, deduped by slug, capped). Powers the "Recent" shortcut in the city
 * picker so returning users don't re-search. localStorage-backed, hydrated after
 * mount, kept in sync via the same custom event as the selected market.
 */
export function useRecentMarkets(): [Market[], (m: Market) => void] {
  const [recents, setRecents] = useState<Market[]>([]);

  useEffect(() => {
    setRecents(readRecents());
  }, []);

  useEffect(() => {
    const sync = (event: Event) => {
      const fallback = fallbackOf(event);
      if (!fallback) setRecents(readRecents());
      else if (fallback.recents !== undefined) setRecents(fallback.recents);
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const pushRecent = useCallback((m: Market) => {
    if (typeof window === 'undefined') return;
    const next = [m, ...readRecents().filter((r) => r.slug !== m.slug)].slice(0, RECENTS_MAX);
    let stored = true;
    try {
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable — keep the list in memory
      stored = false;
    }
    setRecents(next);
    announce(stored ? undefined : { recents: next });
  }, []);

  return [recents, pushRecent];
}
