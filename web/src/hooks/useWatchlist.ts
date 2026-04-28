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

/** The signed-in user's watchlist, hydrated as full listing rows. */
export function useWatchlist(page?: number) {
  const sp = new URLSearchParams();
  if (page !== undefined) sp.set('page', String(page));
  const qs = sp.toString();
  const path = `/api/v1/me/watchlist${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ['watchlist', page ?? 1],
    queryFn: () => api.get<MyListingsResponse>(path),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Saved searches
// ─────────────────────────────────────────────────────────────────────────

export type SavedSearchAlertFrequency = 'instant' | 'daily' | 'weekly' | 'off';

export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  query: SearchListingsParams;
  alert_frequency: SavedSearchAlertFrequency;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
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
