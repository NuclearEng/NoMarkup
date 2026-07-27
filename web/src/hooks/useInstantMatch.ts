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
  /** Schedule-eligible Instant providers that received in-app fan-out. */
  providers_notified?: number;
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
    onSuccess: (data) => {
      // Honest copy: providers_notified is the schedule-eligible Instant fan-out
      // count (in-app). Providers also discover offers by polling the inbox.
      const n =
        typeof data.providers_notified === 'number' && data.providers_notified >= 0
          ? data.providers_notified
          : null;
      const when = data.expires_at ? new Date(data.expires_at) : null;
      const expiresLabel =
        when && !Number.isNaN(when.getTime())
          ? when.toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : data.expires_at;

      if (n === 0) {
        toast.message(
          expiresLabel
            ? `Instant offer is live until ${expiresLabel}, but no providers are currently available for Instant. Keep the auction open or re-request later.`
            : 'Instant offer is live, but no providers are currently available for Instant. Keep the auction open or re-request later.',
        );
        return;
      }
      if (n !== null && n > 0) {
        toast.success(
          expiresLabel
            ? `Instant match sent to ${String(n)} available provider${n === 1 ? '' : 's'}. Offers expire ${expiresLabel}.`
            : `Instant match sent to ${String(n)} available provider${n === 1 ? '' : 's'}.`,
        );
        return;
      }
      toast.success(
        expiresLabel
          ? `Instant match sent. Offers expire ${expiresLabel}.`
          : 'Instant match sent. Providers with Instant availability will see the offer.',
      );
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to start instant match.'));
    },
  });
}
