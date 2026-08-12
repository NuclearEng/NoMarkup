import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
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
  phone?: string | null;
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
    phone: raw.phone ?? null,
    phoneVerified: raw.phone_verified,
    mfaEnabled: raw.mfa_enabled,
    createdAt: raw.created_at,
  };
}

function explainProfileFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      toast.error(err.userMessage(fallback));
      return;
    }
    toast.error(fallback);
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

/** POST /api/v1/auth/send-phone-otp — auth required. Body: `{ phone }`. */
export function useSendPhoneOtp() {
  return useMutation({
    mutationFn: (phone: string) =>
      api.post<{ sent: boolean }>('/api/v1/auth/send-phone-otp', { phone }),
    onSuccess: () => {
      toast.success('Verification code sent');
    },
    onError: explainProfileFailure('Failed to send verification code'),
  });
}

/** POST /api/v1/auth/verify-phone — auth required. Body: `{ otp_code }`. */
export function useVerifyPhone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (otpCode: string) =>
      api.post<{ verified: boolean }>('/api/v1/auth/verify-phone', { otp_code: otpCode }),
    onSuccess: () => {
      toast.success('Phone verified');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: explainProfileFailure('Failed to verify phone'),
  });
}
