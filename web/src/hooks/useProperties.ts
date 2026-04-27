import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';

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
}

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: () =>
      api
        .get<{ properties: Property[] }>('/api/v1/properties')
        .then((res) => res.properties),
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    // Gateway returns the property at the top level, not wrapped in { property }.
    mutationFn: async (input: CreatePropertyInput) => {
      const raw = await api.post<Record<string, unknown>>('/api/v1/properties', input);
      return raw as unknown as Property;
    },
    onSuccess: () => {
      toast.success('Property added');
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
    onError: () => {
      toast.error('Failed to add property');
    },
  });
}

export function useUpdateProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    // Gateway exposes PUT /api/v1/properties/{id} (not PATCH); previous PATCH
    // returned 405 and the update silently never happened. Also unwraps the
    // flat-shaped response.
    mutationFn: async (variables: { id: string; input: Partial<CreatePropertyInput> }) => {
      const raw = await api.put<Record<string, unknown>>(
        `/api/v1/properties/${variables.id}`,
        variables.input,
      );
      return raw as unknown as Property;
    },
    onSuccess: () => {
      toast.success('Property updated');
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
    onError: () => {
      toast.error('Failed to update property');
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
    onError: () => {
      toast.error('Failed to remove property');
    },
  });
}
