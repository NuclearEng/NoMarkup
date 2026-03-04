import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import type {
  Bid,
  BidCountResponse,
  BidsForJobResponse,
  MyBidsResponse,
  PlaceBidInput,
  UpdateBidInput,
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
      api
        .post<{ bid: Bid }>(`/api/v1/jobs/${jobId}/bids/accept-offer`)
        .then((res) => res.bid),
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
      api
        .post<{ bid: Bid }>(`/api/v1/jobs/${jobId}/bids/${bidId}/award`)
        .then((res) => res.bid),
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
