import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api, clearIdempotencyKey, getApiErrorMessage, idempotencyHeader } from '@/lib/api';
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
  ReportNoShowResponse,
  SearchListingsParams,
  SimilarListingsResponse,
  UpdateListingInput,
} from '@/types';

/**
 * Wire shape of a listing as it actually arrives from the API: `photos` can be
 * `null` for photo-less listings even though the `Listing` type declares it a
 * non-null array. Typing the boundary as nullable keeps the `?? []`
 * normalization below honest (the value is genuinely nullable here) instead of
 * being a type-dead guard against the over-strict `Listing` type.
 */
type RawListing<T extends Listing = Listing> = Omit<T, 'photos'> & {
  photos: T['photos'] | null;
};

/**
 * Normalize a listing's `photos` to a non-null array.
 *
 * The API can return `photos: null` for listings with no photos, but the
 * `Listing` type declares `photos: ListingPhoto[]`. The two RSC server pages
 * already do `photos: res.listing.photos ?? []`; this mirrors that for the
 * client hooks so every call site receives a guaranteed array and never
 * null-derefs (`listing.photos.find(...)`, `listing.photos[0]`, etc.).
 */
function normalizeListing<T extends Listing>(listing: RawListing<T>): T {
  return { ...listing, photos: listing.photos ?? [] } as T;
}

function explainListingFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      const status = err.status;
      if (status === 403) {
        toast.error('Sellers cannot bid on their own listings.');
        return;
      }
      if (status === 409) {
        toast.error('Bid rejected: auction not active, ended, or you already hold the high bid.');
        return;
      }
      if (status === 402) {
        toast.error('A bid bond is required before bidding on this listing.');
        return;
      }
      // getApiErrorMessage also rewrites "N cents" → "$X.YY" for money UX.
      toast.error(getApiErrorMessage(err, fallback));
      return;
    }
    toast.error(fallback);
  };
}

function buildSearchParams(params: SearchListingsParams): string {
  const sp = new URLSearchParams();
  if (params.query) sp.set('q', params.query);
  if (params.category_id) sp.set('category_id', params.category_id);
  if (params.category_slug) sp.set('category_slug', params.category_slug);
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

/**
 * Marketplace browse/search query.
 *
 * Accepts an optional `initialData` so a Server Component can seed the cache
 * for the default-filter key — the browse page then renders the server-fetched
 * grid on first paint instead of the loading skeleton (RSC-first browse page).
 * Only the default-filter query is seeded; once the user changes filters the
 * query key changes, no seed exists, and TanStack refetches client-side as
 * before (UX unchanged).
 */
export function useListings(
  params: SearchListingsParams,
  options?: { initialData?: ListingsResponse },
) {
  return useQuery({
    queryKey: ['listings', 'search', params],
    queryFn: () =>
      api
        .getPublic<
          Omit<ListingsResponse, 'listings'> & { listings: RawListing[] }
        >(`/api/v1/listings${buildSearchParams(params)}`)
        .then((res) => ({ ...res, listings: res.listings.map(normalizeListing) })),
    placeholderData: keepPreviousData,
    ...(options?.initialData ? { initialData: options.initialData } : {}),
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
      api
        .getPublic<
          Omit<ListingsResponse, 'listings'> & { listings: RawListing[] }
        >(`/api/v1/listings?sort_by=trending&page_size=${String(limit)}`)
        .then((res) => ({ ...res, listings: res.listings.map(normalizeListing) })),
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
// Return type is pinned explicitly. With a possibly-undefined initialData,
// TanStack's overloads resolve to the "initialData is always present"
// variant, which types `data` as always-defined — false whenever the query
// is loading or disabled via `enabled`, and it made every `!listing`
// loading guard look like dead code to the linter.
export function useListing(
  id: string,
  options?: { initialData?: ListingDetail },
): UseQueryResult<ListingDetail> {
  return useQuery({
    queryKey: ['listings', id],
    queryFn: () =>
      api
        .getPublic<{ listing: RawListing<ListingDetail> }>(`/api/v1/listings/${id}`)
        .then((res) => normalizeListing(res.listing)),
    enabled: !!id,
    // Passing `undefined` is equivalent to omitting the key at runtime.
    initialData: options?.initialData,
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
      api
        .getPublic<SimilarListingsResponse>(`/api/v1/listings/${listingId}/similar?limit=12`)
        .then((res) => ({ ...res, listings: res.listings.map(normalizeListing) })),
    enabled: !!listingId,
    staleTime: 60_000,
  });
}

export function useListingBids(listingId: string) {
  return useQuery({
    queryKey: ['listings', listingId, 'bids'],
    queryFn: () => api.getPublic<ListingBidHistory>(`/api/v1/listings/${listingId}/bids`),
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
    queryFn: () =>
      api
        .get<MyListingsResponse>(path)
        .then((res) => ({ ...res, listings: res.listings.map(normalizeListing) })),
  });
}

export function useMyListingBids(page?: number) {
  const sp = new URLSearchParams();
  if (page !== undefined) sp.set('page', String(page));
  const qs = sp.toString();
  const path = `/api/v1/listings/bids/mine${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ['listingBids', 'mine', page],
    queryFn: () =>
      api.get<MyListingBidsResponse>(path).then((res) => ({
        ...res,
        bids: res.bids.map((entry) => ({
          ...entry,
          listing: normalizeListing(entry.listing),
        })),
      })),
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

/**
 * eBay-style 60s retraction for the caller's current high bid.
 * Server enforces ownership, active status, and the 60s window.
 */
export function useRetractListingBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, bidId }: { listingId: string; bidId: string }) =>
      api.post<{ listing: Listing | null; bid_id: string }>(
        `/api/v1/listings/${listingId}/bids/${bidId}/retract`,
      ),
    onSuccess: (_data, variables) => {
      toast.success('Bid retracted');
      void qc.invalidateQueries({ queryKey: ['listingBids', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['listings', variables.listingId] });
      void qc.invalidateQueries({ queryKey: ['listings', variables.listingId, 'bids'] });
      void qc.invalidateQueries({ queryKey: ['listings', 'search'] });
    },
    onError: explainListingFailure('Failed to retract bid'),
  });
}

export function usePlaceListingBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, input }: { listingId: string; input: PlaceListingBidInput }) => {
      // Stable key per listing+amount so double-tap / network retry cannot double-bid.
      // Gateway RequireIdempotencyKey on POST /listings/{id}/bids (MON-06/22).
      const opKey = `listing-bid:${listingId}:${input.amount_cents}`;
      return api.post<PlaceListingBidResponse>(
        `/api/v1/listings/${listingId}/bids`,
        input,
        idempotencyHeader(opKey),
      );
    },
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
      clearIdempotencyKey(`listing-bid:${variables.listingId}:${variables.input.amount_cents}`);
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

/**
 * The authenticated user's "my orders" index — every goods order on which the
 * caller is EITHER the buyer or the seller, newest first.
 *
 * The gateway (GET /api/v1/me/orders → ListMyOrders in
 * gateway/internal/handler/listing_orders.go) wraps the array in an envelope:
 * `{ "orders": [...] }` (unlike the singular GET /orders/{id}, which returns the
 * order at the top level). We unwrap `.orders` here and default to `[]` so the
 * page always receives an array even on an empty/edge response.
 *
 * Each row is the enriched ListingOrder shape (listing_title, listing_photo_url,
 * seller_display_name, status, amount_cents, pickup_*, created_at, plus
 * buyer_id/seller_id). Because the endpoint mixes both roles into one list, the
 * page derives the caller's per-order role by comparing the current user's id
 * against buyer_id / seller_id — there is no separate buyer/seller endpoint.
 */
export function useMyOrders() {
  return useQuery({
    queryKey: ['listingOrders', 'mine'],
    queryFn: () =>
      api
        .get<{ orders: ListingOrder[] | null }>('/api/v1/me/orders')
        .then((res) => res.orders ?? []),
  });
}

export function useListingOrder(orderId: string) {
  return useQuery({
    queryKey: ['listingOrders', orderId],
    // The gateway returns the order at the top level (GET /orders/{id} →
    // listing_orders.go writeJSON(order)), not wrapped in { order }. Reading the
    // envelope here yielded undefined → the order page rendered "Order not found"
    // despite a 200 (affects both buy-now and accepted-offer orders).
    queryFn: () => api.get<ListingOrder>(`/api/v1/orders/${orderId}`),
    enabled: !!orderId,
  });
}

export function useConfirmPickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      api.post<{ escrow_status: string; both_confirmed: boolean }>(
        `/api/v1/orders/${orderId}/confirm-pickup`,
      ),
    onSuccess: (data, orderId) => {
      // Escrow only releases once BOTH parties confirm. If the seller hasn't
      // confirmed yet the buyer's confirmation is recorded but funds stay in
      // escrow — don't claim they were released.
      toast.success(
        data.both_confirmed
          ? 'Pickup confirmed — escrow released to seller'
          : 'Pickup confirmed — waiting on the seller to confirm before escrow releases',
      );
      void qc.invalidateQueries({ queryKey: ['listingOrders', orderId] });
    },
    onError: explainListingFailure('Failed to confirm pickup'),
  });
}

// The seller's half of the mutual pickup handshake. /confirm-pickup is buyer-only
// (403 for the seller); the seller confirms via /seller-confirm. Escrow releases
// once both sides have confirmed.
export function useSellerConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      api.post<{ order: ListingOrder }>(`/api/v1/orders/${orderId}/seller-confirm`),
    onSuccess: (_data, orderId) => {
      toast.success('Handoff confirmed');
      void qc.invalidateQueries({ queryKey: ['listingOrders', orderId] });
    },
    onError: explainListingFailure('Failed to confirm handoff'),
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
      api.post<{
        dispute_id: string;
        order_id: string;
        escrow_status: string;
        status: string;
      }>(`/api/v1/orders/${orderId}/file-dispute`, {
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

/** POST /api/v1/orders/{id}/report-no-show — either party while escrow is held. */
export function useReportOrderNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      api.post<ReportNoShowResponse>(`/api/v1/orders/${orderId}/report-no-show`, {}),
    onSuccess: (_data, orderId) => {
      toast.success('No-show reported');
      void qc.invalidateQueries({ queryKey: ['listingOrders', orderId] });
      void qc.invalidateQueries({ queryKey: ['listingOrders', 'mine'] });
    },
    onError: explainListingFailure('Failed to report no-show'),
  });
}
