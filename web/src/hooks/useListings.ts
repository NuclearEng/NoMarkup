import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type {
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

export function useListing(id: string) {
  return useQuery({
    queryKey: ['listings', id],
    queryFn: () =>
      api
        .getPublic<{ listing: ListingDetail }>(`/api/v1/listings/${id}`)
        .then((res) => res.listing),
    enabled: !!id,
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
    onError: explainListingFailure('Failed to place bid'),
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
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      api.post<{ order: ListingOrder }>(`/api/v1/orders/${orderId}/dispute`, { reason }),
    onSuccess: (_data, variables) => {
      toast.success('Dispute opened — our team will review within 24h');
      void qc.invalidateQueries({ queryKey: ['listingOrders', variables.orderId] });
    },
    onError: explainListingFailure('Failed to open dispute'),
  });
}
