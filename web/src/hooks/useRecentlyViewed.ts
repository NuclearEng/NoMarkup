'use client';

/**
 * useRecentlyViewed — localStorage-backed list of the last 12 listings the
 * user opened. Powers the "Recently viewed" rail on the marketplace home.
 *
 * Storage shape (`localStorage["nm:recently-viewed"]`):
 *   [{ id: string, visitedAt: string ISO8601 }]
 *
 * Why localStorage and not the server: this is a private comfort feature,
 * not behavioral data. Keeping it client-only avoids needing a new API
 * surface, dodges PII concerns, and works for signed-out browsers.
 *
 * Concurrency: we listen for the `storage` event so two tabs viewing
 * different listings stay in sync.
 *
 * Iframes / SSR: every read is guarded against `typeof window === 'undefined'`
 * so the hook is safe to import from server components and during the
 * initial Next.js render pass.
 */

import { useQueries } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { ListingDetail, ListingPhoto } from '@/types';

const STORAGE_KEY = 'nm:recently-viewed';
const MAX_ENTRIES = 12;

export interface RecentlyViewedEntry {
  id: string;
  visitedAt: string;
}

function readStorage(): RecentlyViewedEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: RecentlyViewedEntry[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { visitedAt?: unknown }).visitedAt === 'string'
      ) {
        out.push({
          id: (item as RecentlyViewedEntry).id,
          visitedAt: (item as RecentlyViewedEntry).visitedAt,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writeStorage(entries: RecentlyViewedEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage disabled — fail silent.
  }
}

/**
 * Returns the current list of recently viewed listing IDs, sorted newest
 * first. Reactive across tabs via the `storage` event.
 */
export function useRecentlyViewed(): {
  entries: RecentlyViewedEntry[];
  clear: () => void;
} {
  // Initialize EMPTY (not from storage) so the server render and the first
  // client render match — reading localStorage in the useState initializer
  // makes the first client render differ from SSR and triggers a hydration
  // mismatch. Populate from storage in an effect after mount instead.
  const [entries, setEntries] = useState<RecentlyViewedEntry[]>([]);

  useEffect(() => {
    setEntries(readStorage());
    function handleStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setEntries(readStorage());
    }
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const clear = useCallback(() => {
    writeStorage([]);
    setEntries([]);
  }, []);

  return { entries, clear };
}

/**
 * Records a listing as recently viewed. Call from a useEffect on mount of
 * the listing detail page.
 *
 * Behavior:
 *   - Upsert: if `id` is already present, move it to the front and refresh
 *     `visitedAt`. The list never contains duplicates.
 *   - Cap: trims to MAX_ENTRIES (12) after each insert.
 *   - No-op when localStorage is unavailable (e.g., SSR, private mode).
 */
export function useRecordRecentView(id: string | undefined): void {
  useEffect(() => {
    if (!id) return;
    if (typeof window === 'undefined') return;
    const current = readStorage();
    const filtered = current.filter((entry) => entry.id !== id);
    const next: RecentlyViewedEntry[] = [
      { id, visitedAt: new Date().toISOString() },
      ...filtered,
    ].slice(0, MAX_ENTRIES);
    writeStorage(next);
  }, [id]);
}

/**
 * Fetches the listing detail for each recently-viewed ID via TanStack Query.
 * Uses parallel queries (one per ID) so cached responses can be reused
 * across pages — the listing detail page already populates the same cache
 * keys via `useListing(id)`.
 *
 * Empty input returns an empty array of results; callers can `.filter` on
 * `data` to drop pending entries.
 */
export function useRecentlyViewedListings(limit = 6): {
  listings: ListingDetail[];
  isLoading: boolean;
} {
  const { entries } = useRecentlyViewed();
  const ids = entries.slice(0, limit).map((entry) => entry.id);

  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['listings', id],
      queryFn: () =>
        api
          // The API can return `photos: null` for listings with no images, so
          // type the raw response as nullable and normalize to [] — cards read
          // photos[0] and would otherwise crash ("undefined is not an object").
          .getPublic<{ listing: Omit<ListingDetail, 'photos'> & { photos?: ListingPhoto[] | null } }>(
            `/api/v1/listings/${id}`,
          )
          .then((res): ListingDetail => ({ ...res.listing, photos: res.listing.photos ?? [] })),
      enabled: !!id,
      staleTime: 60_000,
      retry: false,
    })),
  });

  const listings = queries
    .map((q) => q.data)
    .filter((v): v is ListingDetail => v != null);
  const isLoading = queries.some((q) => q.isLoading);

  return { listings, isLoading };
}
