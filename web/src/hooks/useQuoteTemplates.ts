import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  CreateQuoteTemplateInput,
  QuoteTemplate,
  QuoteTemplatesResponse,
  UpdateQuoteTemplateInput,
} from '@/types';

/**
 * Fetches the requesting provider's reusable quote templates. The
 * gateway sorts by use_count DESC, so the picker should render in
 * the order returned.
 */
export function useQuoteTemplates() {
  return useQuery({
    queryKey: ['quoteTemplates'],
    queryFn: async (): Promise<QuoteTemplate[]> => {
      const res = await api.get<QuoteTemplatesResponse>('/api/v1/me/quote-templates');
      return res.templates;
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateQuoteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQuoteTemplateInput): Promise<QuoteTemplate> =>
      api.post<QuoteTemplate>('/api/v1/me/quote-templates', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quoteTemplates'] });
    },
  });
}

export function useUpdateQuoteTemplate(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateQuoteTemplateInput): Promise<{ updated: boolean }> =>
      api.patch<{ updated: boolean }>(`/api/v1/me/quote-templates/${templateId}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quoteTemplates'] });
    },
  });
}

export function useDeleteQuoteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string): Promise<{ deleted: boolean }> =>
      api.delete<{ deleted: boolean }>(`/api/v1/me/quote-templates/${templateId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quoteTemplates'] });
    },
  });
}

/**
 * Increments use_count for a template — call this when a provider
 * applies a template to a bid so popular ones float to the top of
 * the picker on the next read.
 */
export function useIncrementQuoteTemplateUse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string): Promise<{ use_count: number }> =>
      api.post<{ use_count: number }>(`/api/v1/me/quote-templates/${templateId}/use`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quoteTemplates'] });
    },
  });
}
