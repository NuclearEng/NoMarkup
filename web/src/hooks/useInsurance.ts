import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';
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
    queryFn: () =>
      api.post<{ quote: InsuranceQuote }>('/api/v1/insurance/quote', {
        contract_id: contractId,
        product_id: productId,
      }),
    enabled: !!contractId && !!productId,
  });
}

export function usePurchaseInsurance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      contract_id: string;
      product_id: string;
      payment_method_id: string;
    }) =>
      api
        .post<{ policy: InsurancePolicy }>('/api/v1/insurance/purchase', variables)
        .then((res) => res.policy),
    onSuccess: () => {
      toast.success('Insurance purchased successfully');
      void queryClient.invalidateQueries({ queryKey: ['my-policies'] });
    },
    onError: () => {
      toast.error('Failed to purchase insurance');
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
    queryFn: () =>
      api.get<{ policy: InsurancePolicy }>(`/api/v1/insurance/policies/${id}`),
    enabled: !!id,
  });
}

export function useFileInsuranceClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: FileInsuranceClaimInput) =>
      api
        .post<{ claim: InsuranceClaim }>('/api/v1/insurance/claims', input)
        .then((res) => res.claim),
    onSuccess: () => {
      toast.success('Claim filed successfully');
      void queryClient.invalidateQueries({ queryKey: ['my-policies'] });
      void queryClient.invalidateQueries({ queryKey: ['insurance-claims'] });
    },
    onError: () => {
      toast.error('Failed to file claim');
    },
  });
}

export function useInsuranceClaim(id: string) {
  return useQuery({
    queryKey: ['insurance-claim', id],
    queryFn: () =>
      api.get<{ claim: InsuranceClaim }>(`/api/v1/insurance/claims/${id}`),
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
    mutationFn: (variables: {
      claimId: string;
      action: 'approve' | 'deny';
      approved_amount_cents?: number;
      denial_reason?: string;
    }) =>
      api.post<{ claim: InsuranceClaim }>(
        `/api/v1/admin/insurance/claims/${variables.claimId}/review`,
        {
          action: variables.action,
          approved_amount_cents: variables.approved_amount_cents,
          denial_reason: variables.denial_reason,
        },
      ),
    onSuccess: () => {
      toast.success('Claim reviewed');
      void queryClient.invalidateQueries({ queryKey: ['admin-insurance-claims'] });
    },
    onError: () => {
      toast.error('Failed to review claim');
    },
  });
}
