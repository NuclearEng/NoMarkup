import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import type { TaxForm, TaxFormsResponse } from '@/types';

export function useTaxForms() {
  return useQuery({
    queryKey: ['tax-forms'],
    queryFn: () => api.get<TaxFormsResponse>('/api/v1/providers/me/tax-forms'),
  });
}

export function useGenerateTaxForm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (year: number) =>
      api
        .post<{ form: TaxForm }>(`/api/v1/providers/me/tax-forms/${String(year)}/generate`)
        .then((res) => res.form),
    onSuccess: () => {
      toast.success('Tax form generated');
      void queryClient.invalidateQueries({ queryKey: ['tax-forms'] });
    },
    onError: () => {
      toast.error('Failed to generate tax form');
    },
  });
}

export function useGenerateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (contractId: string) =>
      api
        .post<{ download_url: string }>(`/api/v1/contracts/${contractId}/invoice`)
        .then((res) => res.download_url),
    onSuccess: () => {
      toast.success('Invoice generated');
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: () => {
      toast.error('Failed to generate invoice');
    },
  });
}
