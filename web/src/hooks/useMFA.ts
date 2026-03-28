import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

interface EnableMFAResponse {
  secret: string;
  qr_code_url: string;
  backup_codes: string[];
}

interface VerifyMFASetupInput {
  totp_code: string;
  backup_codes: string[];
}

interface DisableMFAInput {
  totp_code: string;
}

interface VerifyMFALoginInput {
  mfa_challenge_token: string;
  totp_code: string;
}

interface VerifyMFALoginResponse {
  access_token: string;
  access_token_expires_at: string;
}

export function useEnableMFA() {
  return useMutation({
    mutationFn: () =>
      api.post<EnableMFAResponse>('/api/v1/auth/mfa/enable'),
  });
}

export function useVerifyMFASetup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: VerifyMFASetupInput) =>
      api.post<{ success: boolean }>('/api/v1/auth/mfa/verify-setup', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useDisableMFA() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: DisableMFAInput) =>
      api.delete<{ success: boolean }>('/api/v1/auth/mfa/disable', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useVerifyMFALogin() {
  return useMutation({
    mutationFn: (input: VerifyMFALoginInput) =>
      api.postUnauthed<VerifyMFALoginResponse>(
        '/api/v1/auth/mfa/verify',
        input,
      ),
  });
}
