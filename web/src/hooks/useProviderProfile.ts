import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
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
    queryFn: () =>
      api
        .get<{ profile: ProviderProfile }>('/api/v1/providers/me')
        .then((res) => res.profile),
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

export function useSetAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { instant_enabled: boolean; instant_available: boolean }) =>
      api
        .put<{ instant_enabled: boolean; instant_available: boolean }>(
          '/api/v1/providers/me/availability',
          input,
        )
        .then((res) => res),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}
