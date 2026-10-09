// Linked OAuth accounts — list + unlink (ASR-5.1.1.v).
//
// Pairs with gateway UserHandler.ListOAuthAccounts / UnlinkOAuthAccount.
// Unlink is lockout-safe server-side: password OR another oauth must remain.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';

export type OAuthProvider = 'google' | 'apple' | 'facebook';

export interface OAuthAccount {
  provider: OAuthProvider | string;
  email?: string | null;
  linked_at: string;
}

export interface OAuthAccountsResponse {
  accounts: OAuthAccount[];
}

const OAUTH_ACCOUNTS_KEY = ['oauth-accounts'] as const;

export function useOAuthAccounts() {
  return useQuery({
    queryKey: OAUTH_ACCOUNTS_KEY,
    queryFn: () => api.get<OAuthAccountsResponse>('/api/v1/users/me/oauth-accounts'),
    staleTime: 60 * 1000,
  });
}

export function useUnlinkOAuthAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) =>
      api.delete<{ unlinked: boolean; provider: string }>(
        `/api/v1/users/me/oauth-accounts/${encodeURIComponent(provider)}`,
      ),
    onSuccess: (_data, provider) => {
      void qc.invalidateQueries({ queryKey: OAUTH_ACCOUNTS_KEY });
      toast.success(
        `${provider.charAt(0).toUpperCase()}${provider.slice(1)} account disconnected`,
      );
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Failed to disconnect account'));
    },
  });
}
