import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { UpdateUserInput, User } from '@/types';

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ user: User }>('/api/v1/users/me').then((res) => res.user),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateUserInput) =>
      api.patch<{ user: User }>('/api/v1/users/me', input).then((res) => res.user),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useEnableRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (role: string) =>
      api.post<{ user: User }>('/api/v1/users/me/roles', { role }).then((res) => res.user),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
