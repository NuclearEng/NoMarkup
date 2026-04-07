import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';

interface ProviderOffer {
  job_id: string;
  job_title: string;
  job_location: string;
  expires_at: string;
  amount_cents: number;
}

interface ProviderOffersResponse {
  offers: ProviderOffer[];
}

interface InstantMatchResponse {
  status: string;
  expires_at: string;
}

export function useProviderOffers() {
  return useQuery({
    queryKey: ['provider-offers'],
    queryFn: () => api.get<ProviderOffersResponse>('/api/v1/provider/offers'),
    refetchInterval: 30000,
  });
}

export function useAcceptOffer(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api.post<{ status: string }>(`/api/v1/provider/offers/${jobId}/accept`),
    onSuccess: () => {
      toast.success('Offer accepted! The customer will be notified.');
      void queryClient.invalidateQueries({ queryKey: ['provider-offers'] });
    },
    onError: () => {
      toast.error('Failed to accept offer. It may have already expired.');
    },
  });
}

export function useDeclineOffer(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api.post<{ status: string }>(`/api/v1/provider/offers/${jobId}/decline`),
    onSuccess: () => {
      toast.success('Offer declined.');
      void queryClient.invalidateQueries({ queryKey: ['provider-offers'] });
    },
    onError: () => {
      toast.error('Failed to decline offer.');
    },
  });
}

export function useCreateInstantMatch(jobId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<InstantMatchResponse>(`/api/v1/jobs/${jobId}/instant-match`),
    onError: () => {
      toast.error('Failed to start instant match.');
    },
  });
}
