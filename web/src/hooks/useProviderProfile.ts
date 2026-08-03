import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api';
import type {
  GlobalTermsInput,
  PortfolioImage,
  ProviderProfile,
  ProviderVerificationDocument,
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

/** FR-2.10 hard lockout — matches user service MaxDocumentResubmissions. */
export const MAX_DOCUMENT_RESUBMISSIONS = 3;

export function isDocumentResubmissionLocked(resubmissionCount: number | undefined | null): boolean {
  return (resubmissionCount ?? 0) >= MAX_DOCUMENT_RESUBMISSIONS;
}

/**
 * Friendly copy when POST /providers/me/documents returns 422 (resubmission
 * lockout) or the server message already mentions contact support.
 */
export function resubmissionLockoutMessage(err: unknown, fallback?: string): string {
  if (err instanceof ApiError && err.status === 422) {
    const server = err.userMessage('');
    if (/resubmission|contact support|maximum/i.test(server)) {
      return 'This document type has no re-uploads left (maximum 3). Contact support to continue verification.';
    }
    if (server) return server;
  }
  return (
    fallback ??
    'This document type has no re-uploads left (maximum 3). Contact support to continue verification.'
  );
}

export const providerDocumentsQueryKey = ['providerVerificationDocuments'] as const;

/**
 * GET `/api/v1/providers/me/documents` — includes `resubmission_count` for FR-2.10 UI.
 */
export function useProviderVerificationDocuments() {
  return useQuery({
    queryKey: providerDocumentsQueryKey,
    queryFn: async (): Promise<ProviderVerificationDocument[]> => {
      const res = await api.get<{ documents: ProviderVerificationDocument[] }>(
        '/api/v1/providers/me/documents',
      );
      return res.documents ?? [];
    },
  });
}

/**
 * Latest document row per `document_type` (API may return history; UI keys on type).
 */
export function indexDocumentsByType(
  documents: ProviderVerificationDocument[] | undefined,
): Record<string, ProviderVerificationDocument> {
  const map: Record<string, ProviderVerificationDocument> = {};
  if (!documents) return map;
  for (const doc of documents) {
    const key = doc.document_type?.trim();
    if (!key) continue;
    // Prefer the row with the higher resubmission_count when duplicates exist.
    const existing = map[key];
    if (
      !existing ||
      (doc.resubmission_count ?? 0) >= (existing.resubmission_count ?? 0)
    ) {
      map[key] = doc;
    }
  }
  return map;
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
      void queryClient.invalidateQueries({ queryKey: providerDocumentsQueryKey });
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
    onSuccess: (data) => {
      // Merge PUT echo into cache so the weekly editor keeps windows even if a
      // concurrent PATCH-shaped profile (no `schedule` key) lands before GET.
      queryClient.setQueryData<ProviderProfile | null>(['providerProfile'], (old) => {
        if (!old) return old;
        return {
          ...old,
          instant_enabled: data.instant_enabled,
          instant_available: data.instant_available,
          // PUT always echoes schedule (possibly []); prefer it over missing key.
          schedule: data.schedule ?? old.schedule ?? [],
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['providerProfile'] });
    },
  });
}
