import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import { saveDraft } from '@/lib/offline-drafts';
import type {
  AutocompleteResponse,
  CreateListingInput,
  Listing,
  ListingBidHistory,
  ListingDetail,
  ListingOrder,
  ListingsResponse,
  MyListingBidsResponse,
  MyListingsResponse,
  PlaceListingBidInput,
  PlaceListingBidResponse,
  SearchListingsParams,
  SimilarListingsResponse,
  UpdateListingInput,
} from '@/types';

function explainListingFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      toast.error(err.userMessage(fallback));
      return;
    }
    toast.error(fallback);
  };
}

function buildSearchParams(params: SearchListingsParams): string {
  const sp = new URLSearchParams();
  if (params.query) sp.set('q', params.query);
  if (params.category_id) sp.set('category_id', params.category_id);
  if (params.pickup_zip) sp.set('pickup_zip', params.pickup_zip);
  if (params.radius_km !== undefined) sp.set('radius_km', String(params.radius_km));
  if (params.lat !== undefined) sp.set('lat', String(params.lat));
  if (params.lng !== undefined) sp.set('lng', String(params.lng));
  if (params.min_price_cents !== undefined)
    sp.set('min_price_cents', String(params.min_price_cents));
  if (params.max_price_cents !== undefined)
    sp.set('max_price_cents', String(params.max_price_cents));
  if (params.ending_soon) sp.set('ending_soon', 'true');
  if (params.sort_by) sp.set('sort_by', params.sort_by);
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.page_size !== undefined) sp.set('page_size', String(params.page_size));
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export function useListings(params: SearchListingsParams) {
  return useQuery({
    queryKey: ['listings', 'search', params],
    queryFn: () =>
      api.getPublic<ListingsResponse>(`/api/v1/listings${buildSearchParams(params)}`),
    placeholderData: keepPreviousData,
  });
}

/**
 * Trending rail on the marketplace homepage.
 *
 * Hits /listings?sort_by=trending which orders by a composite of bid_count,
 * unique-bidder watcher count, and bid velocity (last hour). Used by the
 * <TrendingRail> component above the search bar. Empty arrays pass through
 * silently so the rail can hide itself when nothing is trending.
 */
export function useTrendingListings(limit = 12) {
  return useQuery({
    queryKey: ['listings', 'trending', limit],
    queryFn: () =>
      api.getPublic<ListingsResponse>(
        `/api/v1/listings?sort_by=trending&page_size=${String(limit)}`,
      ),
    staleTime: 30_000,
  });
}

/**
 * Listing detail query.
 *
 * Accepts an optional `initialData` so a Server Component can seed the cache
 * with server-fetched listing content — the page then renders real data on
 * first paint instead of the loading skeleton (RSC-first detail page). The
 * query still refetches in the background (invalidated by live bids / the
 * spectator stream), so the seeded value is only the first-paint snapshot.
 */
export function useListing(id: string, options?: { initialData?: ListingDetail }) {
  return useQuery({
    queryKey: ['listings', id],
    queryFn: () =>
      api
        .getPublic<{ listing: ListingDetail }>(`/api/v1/listings/${id}`)
        .then((res) => res.listing),
    enabled: !!id,
    ...(options?.initialData ? { initialData: options.initialData } : {}),
  });
}

/**
 * Search-as-you-type suggestions for the marketplace SearchBar.
 *
 * Hits the public /listings/autocomplete endpoint (Meilisearch-backed)
 * once the user has typed at least 2 characters. Disabled below 2 chars
 * so we don't fire a request after every keystroke. The component layer
 * is expected to debounce its `q` input — see SearchBar.tsx.
 *
 * staleTime is 30s — autocomplete suggestions are stable enough that
 * repeated identical prefixes within a session don't need to refetch.
 */
export function useListingsAutocomplete(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ['listings', 'autocomplete', trimmed],
    queryFn: () =>
      api.getPublic<AutocompleteResponse>(
        `/api/v1/listings/autocomplete?q=${encodeURIComponent(trimmed)}&limit=10`,
      ),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}

/**
 * "You may also like" rail on the listing detail page.
 *
 * Hits /listings/{id}/similar which returns up to 12 same-category
 * active listings ranked by Meilisearch relevance against the source
 * listing's title+description. Empty array when none found.
 */
export function useSimilarListings(listingId: string) {
  return useQuery({
    queryKey: ['listings', listingId, 'similar'],
    queryFn: () =>
      api.getPublic<SimilarListingsResponse>(
        `/api/v1/listings/${listingId}/similar?limit=12`,
      ),
    enabled: !!listingId,
    staleTime: 60_000,
  });
}

export function useListingBids(listingId: string) {
  return useQuery({
    queryKey: ['listings', listingId, 'bids'],
    queryFn: () =>
      api.getPublic<ListingBidHistory>(`/api/v1/listings/${listingId}/bids`),
    enabled: !!listingId,
    refetchInterval: 5000,
  });
}

export function useMyListings(statusFilter?: string, page?: number) {
  const sp = new URLSearchParams();
  if (statusFilter) sp.set('status', statusFilter);
  if (page !== undefined) sp.set('page', String(page));
  const qs = sp.toString();
  const path = `/api/v1/listings/mine${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ['listings', 'mine', statusFilter, page],
    queryFn: () => api.get<MyListingsResponse>(path),
  });
}

export function useMyListingBids(page?: number) {
  const sp = new URLSearchParams();
  if (page !== undefined) sp.set('page', String(page));
  const qs = sp.toString();
  const path = `/api/v1/listings/bids/mine${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ['listingBids', 'mine', page],
    queryFn: () => api.get<MyListingBidsResponse>(path),
  });
}

export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateListingInput): Promise<Listing> => {
      const raw = await api.post<Record<string, unknown>>('/api/v1/listings', input);
      return raw as unknown as Listing;
    },
    onSuccess: () => {
      toast.success('Listing created');
      void qc.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: explainListingFailure('Failed to create listing'),
  });
}

export function useUpdateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateListingInput }) => {
      const raw = await api.patch<Record<string, unknown>>(`/api/v1/listings/${id}`, input);
      return raw as unknown as Listing;
    },
    onSuccess: () => {
      toast.success('Listing updated');
      void qc.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: explainListingFailure('Failed to update listing'),
  });
}

export function useCancelListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Record<string, never>>(`/api/v1/listings/${id}/cancel`),
    onSuccess: () => {
      toast.success('Listing cancelled');
      void qc.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: explainListingFailure('Failed to cancel listing'),
  });
}

export function useDeleteListingDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<Record<string, never>>(`/api/v1/listings/${id}`),
    onSuccess: () => {
      toast.success('Draft deleted');
      void qc.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: explainListingFailure('Failed to delete draft'),
  });
}

export function usePlaceListingBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, input }: { listingId: string; input: PlaceListingBidInput }) =>
      api.post<PlaceListingBidResponse>(`/api/v1/listings/${listingId}/bids`, input),
    // Optimistic UI: snapshot the current cache, write the optimistic
    // bid amount immediately, and roll back if the mutation errors.
    // Cuts perceived latency on the bid action — the new top bid renders
    // before the round-trip completes.
    onMutate: async ({ listingId, input }) => {
      await qc.cancelQueries({ queryKey: ['listings', listingId] });
      const previousListing = qc.getQueryData<ListingDetail>(['listings', listingId]);
      if (previousListing) {
        const optimistic: ListingDetail = {
          ...previousListing,
          current_bid_cents: input.amount_cents,
          bid_count: previousListing.bid_count + 1,
        };
        qc.setQueryData(['listings', listingId], optimistic);
      }
      return { previousListing };
    },
    onError: (err, variables, context) => {
      if (context?.previousListing) {
        qc.setQueryData(['listings', variables.listingId], context.previousListing);
      }
      explainListingFailure('Failed to place bid')(err);
    },
    onSuccess: (data, variables) => {
      if (data.snipe_extension_applied) {
        toast.success('Bid placed — auction extended due to last-minute bid');
      } else {
        toast.success('Bid placed — you are the highest bidder');
      }
      void qc.invalidateQueries({ queryKey: ['listings', variables.listingId] });
      void qc.invalidateQueries({ queryKey: ['listings', 'search'] });
      void qc.invalidateQueries({ queryKey: ['listingBids', 'mine'] });
    },
  });
}

/**
 * useCreateListingDraft — offline-aware listing creation.
 *
 * When the browser is online, posts straight to /api/v1/listings (same
 * shape as useCreateListing). When offline, persists the input to
 * IndexedDB via offline-drafts.ts and returns a synthetic stub so the
 * UI can show a "draft saved offline" toast and queue navigation. The
 * auto-sync effect (registerAutoSync) drains saved drafts on reconnect.
 */
export function useCreateListingDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateListingInput,
    ): Promise<Listing | { offline: true; key: string }> => {
      const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
      if (!isOnline) {
        const key =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `draft-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
        await saveDraft(key, input);
        return { offline: true, key };
      }
      const raw = await api.post<Record<string, unknown>>('/api/v1/listings', input);
      return raw as unknown as Listing;
    },
    onSuccess: (result) => {
      if ('offline' in result) {
        toast.success('Saved offline — will publish when you reconnect');
        return;
      }
      toast.success('Listing created');
      void qc.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: explainListingFailure('Failed to create listing'),
  });
}

export function useListingOrder(orderId: string) {
  return useQuery({
    queryKey: ['listingOrders', orderId],
    queryFn: () =>
      api.get<{ order: ListingOrder }>(`/api/v1/orders/${orderId}`).then((res) => res.order),
    enabled: !!orderId,
  });
}

export function useConfirmPickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      api.post<{ order: ListingOrder }>(`/api/v1/orders/${orderId}/confirm-pickup`),
    onSuccess: (_data, orderId) => {
      toast.success('Pickup confirmed — escrow released to seller');
      void qc.invalidateQueries({ queryKey: ['listingOrders', orderId] });
    },
    onError: explainListingFailure('Failed to confirm pickup'),
  });
}

export function useDisputeOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      reason,
      description,
    }: {
      orderId: string;
      reason: string;
      description: string;
    }) =>
      api.post<{ order: ListingOrder }>(`/api/v1/orders/${orderId}/file-dispute`, {
        reason,
        description,
      }),
    onSuccess: (_data, variables) => {
      toast.success('Dispute opened — our team will review within 24h');
      void qc.invalidateQueries({ queryKey: ['listingOrders', variables.orderId] });
    },
    onError: explainListingFailure('Failed to open dispute'),
  });
}
