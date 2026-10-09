import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';
import type { Dispute, GuaranteeClaim, PaginationResponse } from '@/types';

// ─── Customer-facing hooks ─────────────────────────────

interface SubmitGuaranteeClaimInput {
  contractId: string;
  reason: string;
  description: string;
  evidence_urls: string[];
}

export function useSubmitGuaranteeClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: SubmitGuaranteeClaimInput) =>
      api.post<Dispute>(
        `/api/v1/contracts/${variables.contractId}/guarantee-claim`,
        {
          reason: variables.reason,
          description: variables.description,
          evidence_urls: variables.evidence_urls,
        },
      ),
    onSuccess: (_data, variables) => {
      toast.success('Guarantee claim submitted successfully');
      void queryClient.invalidateQueries({
        queryKey: ['contract', variables.contractId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['guarantee-claim', variables.contractId],
      });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to submit guarantee claim'));
    },
  });
}

export function useGuaranteeClaim(contractId: string) {
  return useQuery({
    queryKey: ['guarantee-claim', contractId],
    queryFn: () =>
      api.get<{ guarantee_claim: GuaranteeClaim | null }>(
        `/api/v1/contracts/${contractId}/guarantee-claim`,
      ),
    enabled: !!contractId,
  });
}

// ─── Admin hooks ───────────────────────────────────────

interface AdminGuaranteeClaimsParams {
  status?: string;
  page?: number;
  page_size?: number;
}

export function useAdminGuaranteeClaims(params?: AdminGuaranteeClaimsParams) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const query = searchParams.toString();
  const path = `/api/v1/admin/guarantee-claims${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['admin', 'guarantee-claims', params?.status, params?.page, params?.page_size],
    queryFn: () =>
      api.get<{ guarantee_claims: Dispute[]; pagination: PaginationResponse }>(path),
  });
}

interface ReviewGuaranteeClaimInput {
  claimId: string;
  approved: boolean;
  resolution_notes: string;
  payout_cents?: number;
}

export function useReviewGuaranteeClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: ReviewGuaranteeClaimInput) =>
      api.put<{ guarantee_claim: Dispute }>(
        `/api/v1/admin/guarantee-claims/${variables.claimId}/review`,
        {
          approved: variables.approved,
          resolution_notes: variables.resolution_notes,
          payout_cents: variables.payout_cents ?? 0,
        },
      ),
    onSuccess: () => {
      toast.success('Guarantee claim reviewed');
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'guarantee-claims'],
      });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to review guarantee claim'));
    },
  });
}
