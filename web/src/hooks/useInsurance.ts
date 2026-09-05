import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';
import type {
  FileInsuranceClaimInput,
  InsuranceClaim,
  InsuranceClaimsResponse,
  InsurancePoliciesResponse,
  InsurancePolicy,
  InsuranceProduct,
  InsuranceQuote,
} from '@/types';

export function useInsuranceProducts() {
  return useQuery({
    queryKey: ['insurance-products'],
    queryFn: () =>
      api.get<{ products: InsuranceProduct[] }>('/api/v1/insurance/products'),
  });
}

export function useInsuranceQuote(contractId: string, productId: string) {
  return useQuery({
    queryKey: ['insurance-quote', contractId, productId],
    // Gateway returns the quote at the top level — wrap it for consistency
    // with the previous shape consumers expect.
    queryFn: async () => {
      const raw = await api.post<InsuranceQuote>('/api/v1/insurance/quote', {
        contract_id: contractId,
        product_id: productId,
      });
      return { quote: raw };
    },
    enabled: !!contractId && !!productId,
  });
}

export function usePurchaseInsurance() {
  const queryClient = useQueryClient();

  return useMutation({
    // Gateway returns flat policy fields (with client_secret merged in for SCA).
    mutationFn: async (variables: {
      contract_id: string;
      product_id: string;
      payment_method_id: string;
    }) => {
      const raw = await api.post<Record<string, unknown>>(
        '/api/v1/insurance/purchase',
        variables,
      );
      return raw as unknown as InsurancePolicy;
    },
    onSuccess: () => {
      toast.success('Insurance purchased successfully');
      void queryClient.invalidateQueries({ queryKey: ['my-policies'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to purchase insurance'));
    },
  });
}

export function useMyPolicies() {
  return useQuery({
    queryKey: ['my-policies'],
    queryFn: () => api.get<InsurancePoliciesResponse>('/api/v1/insurance/policies'),
  });
}

export function useInsurancePolicy(id: string) {
  return useQuery({
    queryKey: ['insurance-policy', id],
    queryFn: async () => {
      const raw = await api.get<InsurancePolicy>(`/api/v1/insurance/policies/${id}`);
      return { policy: raw };
    },
    enabled: !!id,
  });
}

export function useFileInsuranceClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: FileInsuranceClaimInput) => {
      const raw = await api.post<Record<string, unknown>>('/api/v1/insurance/claims', input);
      return raw as unknown as InsuranceClaim;
    },
    onSuccess: () => {
      toast.success('Claim filed successfully');
      void queryClient.invalidateQueries({ queryKey: ['my-policies'] });
      void queryClient.invalidateQueries({ queryKey: ['insurance-claims'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to file claim'));
    },
  });
}

export function useInsuranceClaim(id: string) {
  return useQuery({
    queryKey: ['insurance-claim', id],
    queryFn: async () => {
      const raw = await api.get<InsuranceClaim>(`/api/v1/insurance/claims/${id}`);
      return { claim: raw };
    },
    enabled: !!id,
  });
}

export function useAdminInsuranceClaims(params?: { status?: string; page?: number; page_size?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const query = searchParams.toString();
  const path = `/api/v1/admin/insurance/claims${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['admin-insurance-claims', params?.status, params?.page, params?.page_size],
    queryFn: () => api.get<InsuranceClaimsResponse>(path),
  });
}

export function useReviewInsuranceClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: {
      claimId: string;
      action: 'approve' | 'deny';
      approved_amount_cents?: number;
      denial_reason?: string;
    }) => {
      // The gateway reviewClaimRequest reads a boolean `approved` flag (not an
      // `action` string). Sending `action` left `approved` defaulting to false,
      // so the Approve button silently DENIED the claim and no payout fired.
      const raw = await api.post<Record<string, unknown>>(
        `/api/v1/admin/insurance/claims/${variables.claimId}/review`,
        {
          approved: variables.action === 'approve',
          approved_amount_cents: variables.approved_amount_cents,
          denial_reason: variables.denial_reason,
        },
      );
      return raw as unknown as InsuranceClaim;
    },
    onSuccess: () => {
      toast.success('Claim reviewed');
      void queryClient.invalidateQueries({ queryKey: ['admin-insurance-claims'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to review claim'));
    },
  });
}
