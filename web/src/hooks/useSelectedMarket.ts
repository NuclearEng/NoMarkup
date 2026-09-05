'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Market } from '@/types';

const STORAGE_KEY = 'nm.selectedMarket';
const RECENTS_KEY = 'nm.recentMarkets';
const RECENTS_MAX = 5;
const EVENT = 'nm:selectedMarket';

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
    const sync = () => { setMarketState(read()); };
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setMarket = useCallback((m: Market | null) => {
    if (typeof window === 'undefined') return;
    try {
      if (m) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable (private mode) — fall back to in-memory only
    }
    setMarketState(m);
    window.dispatchEvent(new Event(EVENT));
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
    const sync = () => { setRecents(readRecents()); };
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
    try {
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
    setRecents(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [recents, pushRecent];
}
