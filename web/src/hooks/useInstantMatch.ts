import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';

interface ProviderOffer {
  job_id: string;
  job_title: string;
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
  const router = useRouter();

  return useMutation({
    mutationFn: () =>
      api.post<{ status: string; contract_id?: string }>(
        `/api/v1/provider/offers/${jobId}/accept`,
      ),
    onSuccess: (data) => {
      toast.success('Offer accepted! A contract is ready for you to review.');
      void queryClient.invalidateQueries({ queryKey: ['provider-offers'] });
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      // Accepting an instant-match offer mints a contract; take the provider
      // straight to it so the "becomes a contract" transition is tangible.
      if (data.contract_id) {
        router.push(`/contracts/${data.contract_id}`);
      }
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to accept offer. It may have already expired.'));
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
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to decline offer.'));
    },
  });
}

export function useCreateInstantMatch(jobId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<InstantMatchResponse>(`/api/v1/jobs/${jobId}/instant-match`),
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to start instant match.'));
    },
  });
}
