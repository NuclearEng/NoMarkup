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
        // Gateway returns the profile at the top level (not wrapped in { profile }).
        const raw = await api.get<Record<string, unknown>>('/api/v1/providers/me');
        return raw as unknown as ProviderProfile;
      } catch (error: unknown) {
        // Provider profile may not exist yet (e.g. user just enabled the role).
        // Return null instead of crashing so the dashboard can show onboarding.
        const status =
          error instanceof ApiError ? error.status : (error as { status?: number }).status;
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
    mutationFn: async (input: UpdateProviderInput) => {
      const raw = await api.patch<Record<string, unknown>>('/api/v1/providers/me', input);
      return raw as unknown as ProviderProfile;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}

export function useSetGlobalTerms() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: GlobalTermsInput) => {
      const raw = await api.put<Record<string, unknown>>('/api/v1/providers/me/terms', input);
      return raw as unknown as ProviderProfile;
    },
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

/** Weekly Instant window — matches gateway PUT/GET schedule shape. */
export interface AvailabilityWindowInput {
  day: string;
  start_time: string;
  end_time: string;
}

/**
 * PUT `/api/v1/providers/me/availability`.
 * Wire body uses `enabled` / `available_now` / `schedule` (not the response field
 * names). Empty `schedule` clears previously saved windows server-side — always
 * re-send retained windows when toggling available-now.
 */
export function useSetAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      enabled: boolean;
      available_now: boolean;
      schedule?: AvailabilityWindowInput[];
    }) =>
      api
        .put<{
          instant_enabled: boolean;
          instant_available: boolean;
          schedule?: AvailabilityWindowInput[];
        }>('/api/v1/providers/me/availability', {
          enabled: input.enabled,
          available_now: input.available_now,
          schedule: input.schedule ?? [],
        })
        .then((res) => res),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}
