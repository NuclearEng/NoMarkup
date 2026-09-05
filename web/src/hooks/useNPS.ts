/**
 * useNPS — pending NPS surveys + submission mutation.
 *
 * Polls /api/v1/me/nps/pending every 5 minutes (and on mount) so the
 * <NPSSurvey> modal can mount itself when the notification scheduler
 * inserts a new row. Submission posts to /api/v1/me/nps/{id} and
 * invalidates the pending list to dismiss the modal.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';

export interface PendingNPS {
  id: string;
  context_type: 'listing_order' | 'contract';
  context_id: string;
  prompted_at: string;
}

interface PendingNPSResponse {
  pending: PendingNPS[];
}

export function usePendingNPS() {
  return useQuery({
    queryKey: ['nps', 'pending'],
    queryFn: () => api.get<PendingNPSResponse>('/api/v1/me/nps/pending'),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useSubmitNPS() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, score, comment }: { id: string; score: number; comment?: string }) =>
      api.post<{ submitted: boolean }>(`/api/v1/me/nps/${id}`, {
        score,
        comment: comment ?? '',
      }),
    onSuccess: () => {
      toast.success('Thanks for your feedback');
      void qc.invalidateQueries({ queryKey: ['nps', 'pending'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to submit'));
    },
  });
}
