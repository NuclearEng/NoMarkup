import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import { parseJwtPayload, setAccessToken } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';
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

/** Enable-role returns the user document plus a freshly minted session. */
interface EnableRoleApiResponse extends ApiUser {
  access_token?: string;
  access_token_expires_at?: string;
}

// The pre-grant access JWT stays valid until it expires and still lacks the
// new role. Replace it, and merge roles onto the existing store user so
// display fields are not wiped by a JWT that has no display name.
function rememberEnabledRoleSession(raw: EnableRoleApiResponse, user: User): void {
  const token = raw.access_token?.trim() ?? '';
  const previous = useAuthStore.getState().user;
  if (token.length > 0) {
    const payload = parseJwtPayload(token);
    if (payload && (payload.sub !== '' || user.id !== '')) {
      useAuthStore.getState().adoptSession({
        user_id: user.id || payload.sub,
        access_token: token,
        access_token_expires_at: raw.access_token_expires_at ?? '',
      });
    } else {
      setAccessToken(token);
      useAuthStore.setState({
        accessToken: token,
        isAuthenticated: true,
        isHydrating: false,
      });
    }
  }
  const base = previous ?? useAuthStore.getState().user;
  const roles = user.roles ?? [];
  if (!base) {
    if (token.length > 0) {
      useAuthStore.getState().setUser({ ...user, roles });
    }
    return;
  }
  useAuthStore.getState().setUser({
    ...base,
    id: user.id || base.id,
    email: user.email || base.email,
    displayName: user.displayName || base.displayName,
    avatarUrl: user.avatarUrl ?? base.avatarUrl,
    roles: roles.length > 0 ? roles : base.roles,
    status: user.status || base.status,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    phone: user.phone ?? base.phone,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt || base.createdAt,
  });
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
      api.post<EnableRoleApiResponse>('/api/v1/users/me/roles', { role }).then((raw) => {
        const user = mapApiUser(raw);
        rememberEnabledRoleSession(raw, user);
        return user;
      }),
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
