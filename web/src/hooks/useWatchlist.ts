// Goods-marketplace retention loop — watchlist + saved searches.
//
// Pairs with the gateway handler at gateway/internal/handler/watchlist.go.
// Mirrors the patterns in useListings.ts (TanStack Query, sonner toasts,
// ApiError unwrapping).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type { MyListingsResponse, SearchListingsParams } from '@/types';

function explainWatchlistFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      toast.error(err.userMessage(fallback));
      return;
    }
    toast.error(fallback);
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Watchlist
// ─────────────────────────────────────────────────────────────────────────

export interface WatchListingResponse {
  watching: boolean;
  watcher_count?: number;
}

/**
 * Toggle the watch state on a single listing. Server-side is idempotent
 * (UNIQUE on (user_id, listing_id)); the `watching` parameter chooses the
 * verb. Invalidates the watchlist + per-listing query so the heart icon
 * stays in sync with the rest of the UI.
 */
export function useWatchListing(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ watching }: { watching: boolean }) => {
      if (watching) {
        return api.post<WatchListingResponse>(`/api/v1/listings/${listingId}/watch`);
      }
      return api.delete<WatchListingResponse>(`/api/v1/listings/${listingId}/watch`);
    },
    onSuccess: (_data, variables) => {
      if (variables.watching) {
        toast.success('Added to watchlist');
      } else {
        toast.success('Removed from watchlist');
      }
      void qc.invalidateQueries({ queryKey: ['watchlist'] });
      void qc.invalidateQueries({ queryKey: ['listings', listingId] });
    },
    onError: explainWatchlistFailure('Failed to update watchlist'),
  });
}

/**
 * The signed-in user's watchlist, hydrated as full listing rows.
 *
 * `enabled` lets callers on public surfaces (e.g. the marketplace browse grid)
 * skip the request for logged-out visitors — the endpoint is auth-only and
 * would 401. Defaults to true for the dedicated /me/watchlist page.
 */
export function useWatchlist(page?: number, options?: { enabled?: boolean }) {
  const sp = new URLSearchParams();
  if (page !== undefined) sp.set('page', String(page));
  const qs = sp.toString();
  const path = `/api/v1/me/watchlist${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ['watchlist', page ?? 1],
    queryFn: () => api.get<MyListingsResponse>(path),
    enabled: options?.enabled ?? true,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Saved searches
// ─────────────────────────────────────────────────────────────────────────

export type SavedSearchAlertFrequency = 'instant' | 'daily' | 'weekly' | 'off';

/**
 * The persisted query is polymorphic across schema generations:
 *
 *   - legacy rows store it as a bare free-text string (the raw search box),
 *   - newer rows store an object: `{ q, category }` (and may carry the full
 *     {@link SearchListingsParams} shape going forward).
 *
 * The UI must tolerate both without crashing, so the type is a union and all
 * reads go through {@link summarizeSavedSearchQuery} / {@link savedSearchQueryToParams}.
 */
export interface SavedSearchQueryObject extends Partial<SearchListingsParams> {
  /** New-row alias for the free-text term. */
  q?: string;
  /** New-row alias for the category facet (label or id). */
  category?: string;
}

export type SavedSearchQuery = string | SavedSearchQueryObject;

export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  query: SavedSearchQuery;
  alert_frequency: SavedSearchAlertFrequency;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Narrow the polymorphic saved-search `query` into a flat
 * {@link SearchListingsParams} the marketplace filters understand. A bare
 * string becomes `{ query }`; an object's `q`/`category` aliases are folded
 * onto the canonical `query`/`category_id` fields. Never throws on unexpected
 * shapes — unknown values yield an empty param set.
 */
export function savedSearchQueryToParams(query: SavedSearchQuery): SearchListingsParams {
  if (typeof query === 'string') {
    return query.trim() ? { query: query.trim() } : {};
  }
  if (query !== null && typeof query === 'object') {
    const { q, category, ...rest } = query;
    const params: SearchListingsParams = { ...rest };
    if (q !== undefined && params.query === undefined) params.query = q;
    if (category !== undefined && params.category_id === undefined) {
      params.category_id = category;
    }
    return params;
  }
  return {};
}

/**
 * Human-readable one-line summary of a saved search for list rendering.
 * Tolerates the string-or-object union and degrades to "All auctions" when
 * the query carries no distinguishing facets.
 */
export function summarizeSavedSearchQuery(query: SavedSearchQuery): string {
  const params = savedSearchQueryToParams(query);
  const parts: string[] = [];
  if (params.query) parts.push(`"${params.query}"`);
  if (params.category_id) parts.push(`in ${params.category_id}`);
  if (params.pickup_zip) parts.push(`near ${params.pickup_zip}`);
  if (params.min_price_cents !== undefined || params.max_price_cents !== undefined) {
    const min = params.min_price_cents !== undefined ? `$${String(Math.round(params.min_price_cents / 100))}` : '';
    const max = params.max_price_cents !== undefined ? `$${String(Math.round(params.max_price_cents / 100))}` : '';
    parts.push(min && max ? `${min}–${max}` : min ? `${min}+` : `under ${max}`);
  }
  if (params.ending_soon) parts.push('ending soon');
  return parts.length > 0 ? parts.join(' · ') : 'All auctions';
}

export interface SavedSearchesResponse {
  saved_searches: SavedSearch[];
}

export interface CreateSavedSearchInput {
  name: string;
  query: SearchListingsParams;
  alert_frequency?: SavedSearchAlertFrequency;
}

export function useSavedSearches() {
  return useQuery({
    queryKey: ['savedSearches'],
    queryFn: () => api.get<SavedSearchesResponse>('/api/v1/me/saved-searches'),
  });
}

export function useCreateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavedSearchInput) =>
      api.post<{ saved_search: SavedSearch }>('/api/v1/me/saved-searches', {
        name: input.name,
        query: input.query,
        alert_frequency: input.alert_frequency ?? 'daily',
      }),
    onSuccess: () => {
      toast.success('Search saved — alerts will arrive when matches go live');
      void qc.invalidateQueries({ queryKey: ['savedSearches'] });
    },
    onError: explainWatchlistFailure('Failed to save search'),
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<Record<string, never>>(`/api/v1/me/saved-searches/${id}`),
    onSuccess: () => {
      toast.success('Saved search removed');
      void qc.invalidateQueries({ queryKey: ['savedSearches'] });
    },
    onError: explainWatchlistFailure('Failed to remove saved search'),
  });
}
