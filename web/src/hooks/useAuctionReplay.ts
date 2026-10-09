import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ListingAuctionReplay } from '@/types';

interface ReplayEvent {
  id: string;
  job_id: string;
  event_type: 'bid_placed' | 'bid_updated' | 'bid_withdrawn';
  amount_cents: number;
  created_at: string;
}

interface ReplayData {
  events: ReplayEvent[];
  job_title: string;
  category: string;
  starting_bid_cents: number;
  winning_bid_cents: number;
  total_savings_cents: number;
  duration_seconds: number;
  bid_count: number;
}

export type { ReplayEvent, ReplayData };

export function useAuctionReplay(jobId: string) {
  return useQuery<ReplayData>({
    queryKey: ['auction-replay', jobId],
    queryFn: () => api.getPublic<ReplayData>(`/api/v1/auctions/${jobId}/replay`),
    enabled: !!jobId,
    staleTime: Infinity, // Replay data never changes (completed auctions are immutable)
    gcTime: 1000 * 60 * 60, // Keep in cache for 1 hour
  });
}

/**
 * Goods-side auction replay. Mirrors the services-side hook above but
 * targets /api/v1/listings/{id}/replay and surfaces the
 * AuctionReplayEvent shape (PII-stripped bidder labels, snipe extension
 * synthetics, auto-bid cascade detection).
 */
export function useListingReplay(listingId: string) {
  return useQuery<ListingAuctionReplay>({
    queryKey: ['listing-replay', listingId],
    queryFn: () =>
      api.getPublic<ListingAuctionReplay>(`/api/v1/listings/${listingId}/replay`),
    enabled: !!listingId,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60,
  });
}
