import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api';
import type {
  GlobalTermsInput,
  PortfolioImage,
  ProviderProfile,
  ServiceCategorySummary,
  UpdateProviderInput,
} from '@/types';

export function useProviderProfile() {
  return useQuery({
    queryKey: ['providerProfile'],
    queryFn: async (): Promise<ProviderProfile | null> => {
      try {
        const res = await api.get<{ profile: ProviderProfile }>('/api/v1/providers/me');
        return res.profile ?? null;
      } catch (error: unknown) {
        // Provider profile may not exist yet (e.g. user just enabled the role).
        // Return null instead of crashing so the dashboard can show onboarding.
        const status =
          error instanceof ApiError ? error.status : (error as { status?: number })?.status;
        if (status === 404) {
          return null;
        }
        throw error;
      }
    },
    retry: (failureCount, error) => {
      // Don't retry on 404 — profile just doesn't exist.
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 1;
    },
  });
}

export function useUpdateProviderProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProviderInput) =>
      api
        .patch<{ profile: ProviderProfile }>('/api/v1/providers/me', input)
        .then((res) => res.profile),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}

export function useSetGlobalTerms() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: GlobalTermsInput) =>
      api
        .put<{ profile: ProviderProfile }>('/api/v1/providers/me/terms', input)
        .then((res) => res.profile),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}

export function useUpdateCategories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categoryIds: string[]) =>
      api
        .put<{ categories: ServiceCategorySummary[] }>('/api/v1/providers/me/categories', {
          category_ids: categoryIds,
        })
        .then((res) => res.categories),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}

export function useUpdatePortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (images: { image_url: string; caption: string | null; sort_order: number }[]) =>
      api
        .put<{ images: PortfolioImage[] }>('/api/v1/providers/me/portfolio', { images })
        .then((res) => res.images),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}

export interface UploadDocumentInput {
  document_type: string;
  file_url: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface UploadDocumentResult {
  document_id: string;
  status: string;
}

export function useUploadVerificationDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UploadDocumentInput) =>
      api
        .post<UploadDocumentResult>('/api/v1/providers/me/documents', input)
        .then((res) => res),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}

export function useSetAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { instant_enabled: boolean; instant_available: boolean }) =>
      api
        .put<{
          instant_enabled: boolean;
          instant_available: boolean;
        }>('/api/v1/providers/me/availability', input)
        .then((res) => res),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}
