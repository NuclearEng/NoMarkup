import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';

export interface PropertyAddress {
  street: string;
  city: string;
  state: string;
  zip_code: string;
  latitude?: number;
  longitude?: number;
}

export interface Property {
  id: string;
  nickname: string;
  address: PropertyAddress;
  notes: string | null;
  is_primary?: boolean;
  /** Public CDN URLs (0–5) for property exterior/access photos. */
  photo_urls?: string[];
  active_jobs?: number;
  total_spend_cents?: number;
  created_at: string;
}

export interface CreatePropertyInput {
  nickname: string;
  street: string;
  city: string;
  state: string;
  zip_code: string;
  notes?: string;
  /** 0–5 public CDN URLs from ImageUpload (job_photo context). */
  photo_urls?: string[];
}

/** FR-19.2 preferred-provider row from dedicated API. */
export interface PreferredProvider {
  provider_id: string;
  display_name: string;
  completed_count: number;
  last_completed_at: string | null;
  is_preferred: boolean;
}

export interface PreferredProvidersResponse {
  providers: PreferredProvider[];
  preferred_threshold: number;
}

/** PRD FR-19.2 threshold for the Preferred badge. */
export const PREFERRED_PROVIDER_THRESHOLD = 3;

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: () =>
      api
        .get<{ properties: Property[] }>('/api/v1/properties')
        .then((res) => res.properties),
  });
}

/**
 * FR-19.2 preferred / top providers from completed contracts.
 *
 * - Account-wide: `GET /api/v1/me/preferred-providers`
 * - Optional `propertyId` query on the me endpoint scopes by ownership-gated property
 * - Property path: `GET /api/v1/properties/{id}/preferred-providers` when `usePropertyPath` is true
 *
 * Fail-soft: callers should treat `isError` as a soft empty (no toast).
 */
export function usePreferredProviders(options?: {
  propertyId?: string;
  /** Use the property-scoped path instead of `?property_id=` on /me. */
  usePropertyPath?: boolean;
  enabled?: boolean;
}) {
  const propertyId = options?.propertyId?.trim() || undefined;
  const wantsPropertyPath = options?.usePropertyPath === true;
  // Property-path mode requires an id; without it stay disabled (do not fall back to /me).
  const usePropertyPath = wantsPropertyPath && Boolean(propertyId);
  const enabled =
    options?.enabled !== false && (!wantsPropertyPath || Boolean(propertyId));

  const path = usePropertyPath
    ? `/api/v1/properties/${propertyId as string}/preferred-providers`
    : (() => {
        const params = new URLSearchParams();
        if (propertyId) params.set('property_id', propertyId);
        const q = params.toString();
        return `/api/v1/me/preferred-providers${q ? `?${q}` : ''}`;
      })();

  return useQuery({
    queryKey: ['preferred-providers', propertyId ?? 'account', usePropertyPath ? 'path' : 'me'],
    queryFn: () => api.get<PreferredProvidersResponse>(path),
    enabled,
    // Soft surface — property dashboard still works without this section.
    retry: false,
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    // Gateway returns the property at the top level, not wrapped in { property }.
    mutationFn: async (input: CreatePropertyInput) => {
      // Gateway expects nested address + optional photo_urls (0–5).
      const body = {
        nickname: input.nickname,
        address: {
          street: input.street,
          city: input.city,
          state: input.state,
          zip_code: input.zip_code,
        },
        notes: input.notes ?? '',
        photo_urls: input.photo_urls ?? [],
      };
      const raw = await api.post<Record<string, unknown>>('/api/v1/properties', body);
      return raw as unknown as Property;
    },
    onSuccess: () => {
      toast.success('Property added');
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to add property'));
    },
  });
}

export function useUpdateProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    // Gateway exposes PUT /api/v1/properties/{id} (not PATCH); previous PATCH
    // returned 405 and the update silently never happened. Also unwraps the
    // flat-shaped response.
    mutationFn: async (variables: {
      id: string;
      input: Partial<CreatePropertyInput> & { photo_urls?: string[] };
    }) => {
      const { input } = variables;
      // Address is immutable on update; only nickname/notes/primary/photos.
      const body: Record<string, unknown> = {};
      if (input.nickname !== undefined) body.nickname = input.nickname;
      if (input.notes !== undefined) body.notes = input.notes;
      if (input.photo_urls !== undefined) body.photo_urls = input.photo_urls;
      const raw = await api.put<Record<string, unknown>>(
        `/api/v1/properties/${variables.id}`,
        body,
      );
      return raw as unknown as Property;
    },
    onSuccess: () => {
      toast.success('Property updated');
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to update property'));
    },
  });
}

export function useDeleteProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/api/v1/properties/${id}`),
    onSuccess: () => {
      toast.success('Property removed');
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to remove property'));
    },
  });
}
