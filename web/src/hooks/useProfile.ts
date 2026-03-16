import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { UpdateUserInput, User, UserRole, UserStatus } from '@/types';

/** Shape returned by the gateway (snake_case, no wrapper object). */
interface ApiUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  roles: UserRole[];
  status: UserStatus;
  email_verified: boolean;
  phone_verified: boolean;
  mfa_enabled: boolean;
  created_at: string;
  last_active_at?: string;
}

function mapApiUser(raw: ApiUser): User {
  return {
    id: raw.id,
    email: raw.email,
    displayName: raw.display_name,
    avatarUrl: raw.avatar_url,
    roles: raw.roles,
    status: raw.status,
    emailVerified: raw.email_verified,
    phoneVerified: raw.phone_verified,
    mfaEnabled: raw.mfa_enabled,
    createdAt: raw.created_at,
  };
}

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<ApiUser>('/api/v1/users/me').then(mapApiUser),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateUserInput) =>
      api.patch<ApiUser>('/api/v1/users/me', input).then(mapApiUser),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useEnableRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (role: string) =>
      api.post<ApiUser>('/api/v1/users/me/roles', { role }).then(mapApiUser),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
