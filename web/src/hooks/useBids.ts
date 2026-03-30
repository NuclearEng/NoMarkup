import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useAuctionStore } from '@/stores/auction-store';
import { useCountdown } from '@/hooks/useCountdown';
import type {
  AuctionBidEvent,
  Bid,
  BidCountResponse,
  BidsForJobResponse,
  LiveAuctionState,
  MyBidsResponse,
  PlaceBidInput,
  ProviderStreak,
  UpdateBidInput,
  UserSavings,
} from '@/types';

export function usePlaceBid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, input }: { jobId: string; input: PlaceBidInput }) =>
      api.post<{ bid: Bid }>(`/api/v1/jobs/${jobId}/bids`, input).then((res) => res.bid),
    onSuccess: (_data, variables) => {
      toast.success('Bid placed successfully');
      void queryClient.invalidateQueries({ queryKey: ['jobs', variables.jobId] });
      void queryClient.invalidateQueries({ queryKey: ['bidCount', variables.jobId] });
      void queryClient.invalidateQueries({ queryKey: ['bidsForJob', variables.jobId] });
      void queryClient.invalidateQueries({ queryKey: ['myBids'] });
    },
    onError: () => {
      toast.error('Failed to place bid');
    },
  });
}

export function useUpdateBid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bidId, input }: { bidId: string; input: UpdateBidInput }) =>
      api.patch<{ bid: Bid }>(`/api/v1/bids/${bidId}`, input).then((res) => res.bid),
    onSuccess: () => {
      toast.success('Bid updated');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['bidCount'] });
      void queryClient.invalidateQueries({ queryKey: ['bidsForJob'] });
      void queryClient.invalidateQueries({ queryKey: ['myBids'] });
    },
    onError: () => {
      toast.error('Failed to update bid');
    },
  });
}

export function useWithdrawBid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bidId: string) =>
      api.delete<{ bid: Bid }>(`/api/v1/bids/${bidId}`).then((res) => res.bid),
    onSuccess: () => {
      toast.success('Bid withdrawn');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['bidCount'] });
      void queryClient.invalidateQueries({ queryKey: ['bidsForJob'] });
      void queryClient.invalidateQueries({ queryKey: ['myBids'] });
    },
    onError: () => {
      toast.error('Failed to withdraw bid');
    },
  });
}

export function useAcceptOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) =>
      api.post<{ bid: Bid }>(`/api/v1/jobs/${jobId}/bids/accept-offer`).then((res) => res.bid),
    onSuccess: (_data, jobId) => {
      toast.success('Offer accepted');
      void queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['bidCount', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['bidsForJob', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['myBids'] });
    },
    onError: () => {
      toast.error('Failed to accept offer');
    },
  });
}

export function useAwardBid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, bidId }: { jobId: string; bidId: string }) =>
      api.post<{ bid: Bid }>(`/api/v1/jobs/${jobId}/bids/${bidId}/award`).then((res) => res.bid),
    onSuccess: (_data, variables) => {
      toast.success('Bid awarded — contract created');
      void queryClient.invalidateQueries({ queryKey: ['jobs', variables.jobId] });
      void queryClient.invalidateQueries({ queryKey: ['bidsForJob', variables.jobId] });
      void queryClient.invalidateQueries({ queryKey: ['myBids'] });
    },
    onError: () => {
      toast.error('Failed to award bid');
    },
  });
}

export function useBidsForJob(jobId: string) {
  return useQuery({
    queryKey: ['bidsForJob', jobId],
    queryFn: () => api.get<BidsForJobResponse>(`/api/v1/jobs/${jobId}/bids`),
    enabled: !!jobId,
  });
}

export function useMyBids(statusFilter?: string, page?: number) {
  const searchParams = new URLSearchParams();
  if (statusFilter) searchParams.set('status', statusFilter);
  if (page !== undefined) searchParams.set('page', String(page));
  const query = searchParams.toString();
  const path = `/api/v1/bids/mine${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['myBids', statusFilter, page],
    queryFn: () => api.get<MyBidsResponse>(path),
  });
}

export function useBidCount(jobId: string) {
  return useQuery({
    queryKey: ['bidCount', jobId],
    queryFn: () =>
      api.get<BidCountResponse>(`/api/v1/jobs/${jobId}/bids/count`).then((res) => res.count),
    enabled: !!jobId,
  });
}

/**
 * Live auction state with adaptive polling intervals:
 * - Default: 5s refetch
 * - Under 5 minutes remaining: 2s refetch
 */
export function useLiveAuctionState(jobId: string | undefined, auctionEndsAt?: string | null) {
  const { totalSeconds, isExpired } = useCountdown(auctionEndsAt ?? null);

  // Adaptive polling: faster when time is running out
  const refetchInterval = useMemo(() => {
    if (!jobId || isExpired) return false as const;
    if (totalSeconds > 0 && totalSeconds <= 300) return 2000; // < 5 min: every 2s
    return 5000; // default: every 5s
  }, [jobId, totalSeconds, isExpired]);

  return useQuery({
    queryKey: ['liveAuctionState', jobId],
    queryFn: async () => {
      const response = await api.get<LiveAuctionState>(
        `/api/v1/jobs/${String(jobId)}/auction/state`,
      );
      return response;
    },
    enabled: !!jobId,
    refetchInterval,
  });
}

export function useAuctionEvents(jobId: string | undefined) {
  return useQuery({
    queryKey: ['auctionEvents', jobId],
    queryFn: async () => {
      const response = await api.get<AuctionBidEvent[]>(
        `/api/v1/jobs/${String(jobId)}/auction/events`,
      );
      return response;
    },
    enabled: !!jobId,
  });
}

export function useSavings() {
  return useQuery({
    queryKey: ['savings'],
    queryFn: async () => {
      const response = await api.get<UserSavings[]>('/api/v1/users/me/savings');
      return response;
    },
  });
}

export function useProviderStreaks() {
  return useQuery({
    queryKey: ['providerStreaks'],
    queryFn: async () => {
      const response = await api.get<ProviderStreak[]>('/api/v1/providers/me/streaks');
      return response;
    },
  });
}

// ── New hooks for live auction features ──

/** Hook that subscribes to the auction store for real-time streaming data */
export function useBidStream() {
  const events = useAuctionStore((s) => s.events);
  const currentLowest = useAuctionStore((s) => s.currentLowest);
  const bidCount = useAuctionStore((s) => s.bidCount);
  const connectionStatus = useAuctionStore((s) => s.connectionStatus);
  const orderBook = useAuctionStore((s) => s.orderBook);
  const priceHistory = useAuctionStore((s) => s.priceHistory);
  const bidTimestamps = useAuctionStore((s) => s.bidTimestamps);

  const velocity = useMemo(() => {
    const cutoff = Date.now() - 60_000;
    return bidTimestamps.filter((t) => t >= cutoff).length;
  }, [bidTimestamps]);

  const momentum = useMemo(() => {
    const now = Date.now();
    let recent = 0;
    let older = 0;
    for (const ts of bidTimestamps) {
      const age = now - ts;
      if (age > 60_000) continue;
      if (age <= 30_000) recent++;
      else older++;
    }
    if (recent > older + 1) return 'accelerating' as const;
    if (older > recent + 1) return 'decelerating' as const;
    return 'stable' as const;
  }, [bidTimestamps]);

  const velocityBuckets = useAuctionStore(
    useShallow((s) => {
      const now = Date.now();
      const buckets = [0, 0, 0, 0, 0, 0];
      for (const ts of s.bidTimestamps) {
        const age = now - ts;
        if (age > 60_000) continue;
        const idx = Math.min(5, Math.floor(age / 10_000));
        const bi = 5 - idx;
        if (buckets[bi] !== undefined) buckets[bi]++;
      }
      return buckets;
    }),
  );

  return {
    events,
    currentLowest,
    bidCount,
    connectionStatus,
    isConnected: connectionStatus === 'connected',
    orderBook,
    priceHistory,
    velocity,
    momentum,
    velocityBuckets,
  };
}

/** Computed order book entry with rank and derived fields */
interface OrderBookComputedEntry {
  id: string;
  provider_name: string;
  amount_cents: number;
  trust_score: number;
  trust_tier: string;
  created_at: string;
  is_new: boolean;
  rank: number;
  percentage_of_total: number;
  time_since_bid: string;
}

/** Returns sorted bids with computed fields (rank, % of starting price, time ago) */
export function useOrderBook(startingPrice: number): OrderBookComputedEntry[] {
  const orderBook = useAuctionStore((s) => s.orderBook);

  return useMemo(() => {
    const now = Date.now();
    return orderBook.map((entry, index) => {
      const createdMs = new Date(entry.created_at).getTime();
      const diffMs = now - createdMs;
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHr = Math.floor(diffMin / 60);

      let timeSince: string;
      if (diffSec < 10) {
        timeSince = 'just now';
      } else if (diffSec < 60) {
        timeSince = `${String(diffSec)}s ago`;
      } else if (diffMin < 60) {
        timeSince = `${String(diffMin)}m ago`;
      } else {
        timeSince = `${String(diffHr)}h ago`;
      }

      return {
        ...entry,
        rank: index + 1,
        percentage_of_total:
          startingPrice > 0 ? Math.round((entry.amount_cents / startingPrice) * 100) : 0,
        time_since_bid: timeSince,
      };
    });
  }, [orderBook, startingPrice]);
}
