import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';

export interface Property {
  id: string;
  nickname: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  notes: string | null;
  active_jobs: number;
  total_spend_cents: number;
  created_at: string;
}

export interface CreatePropertyInput {
  nickname: string;
  address: string;
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
    mutationFn: (input: CreatePropertyInput) =>
      api
        .post<{ property: Property }>('/api/v1/properties', input)
        .then((res) => res.property),
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
    mutationFn: (variables: { id: string; input: Partial<CreatePropertyInput> }) =>
      api
        .patch<{ property: Property }>(
          `/api/v1/properties/${variables.id}`,
          variables.input,
        )
        .then((res) => res.property),
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
