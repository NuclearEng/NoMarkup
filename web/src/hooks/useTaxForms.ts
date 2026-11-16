import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, downloadAuthenticated, getApiErrorMessage } from '@/lib/api';
import type { TaxEstimateResponse, TaxForm, TaxFormsResponse } from '@/types';

export function useTaxForms() {
  return useQuery({
    queryKey: ['tax-forms'],
    queryFn: () => api.get<TaxFormsResponse>('/api/v1/providers/me/tax-forms'),
  });
}

/**
 * Authoritative server-computed tax estimate (SE + federal income + state) for
 * the given tax year. The backend is the single source of truth — the client
 * only renders the returned integer-cent figures, never recomputes them.
 */
export function useTaxEstimate(year: number) {
  return useQuery({
    queryKey: ['tax-estimate', year],
    queryFn: () =>
      api.get<TaxEstimateResponse>(
        `/api/v1/providers/me/tax-estimate?year=${String(year)}`,
      ),
  });
}

export function useGenerateTaxForm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (year: number) =>
      api
        .post<{ tax_form: TaxForm }>(`/api/v1/providers/me/tax-forms/${String(year)}/generate`)
        .then((res) => res.tax_form),
    onSuccess: () => {
      toast.success('Tax form generated');
      void queryClient.invalidateQueries({ queryKey: ['tax-forms'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to generate tax form'));
    },
  });
}

export function useGenerateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (contractId: string) => {
      // Backend creates/updates the invoice record and returns a URL to the
      // authenticated download route. We immediately fetch that route with
      // the bearer token and trigger a download so the user gets the file.
      await api.post<{ invoice_url: string }>(`/api/v1/contracts/${contractId}/invoice`);
      await downloadAuthenticated(
        `/api/v1/contracts/${contractId}/invoice/download`,
        `invoice-${contractId}.html`,
      );
    },
    onSuccess: () => {
      toast.success('Invoice generated');
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to generate invoice'));
    },
  });
}
