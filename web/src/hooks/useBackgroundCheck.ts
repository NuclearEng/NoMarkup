import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api, getApiErrorMessage } from '@/lib/api';

/**
 * Provider self-service Checkr row (GET/POST /providers/me/background-check).
 * Status is vendor-shaped only — never invent "passed" / PASS client-side.
 */
export const PROVIDER_BG_CHECK_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  CLEAR: 'clear',
  CONSIDER: 'consider',
  SUSPENDED: 'suspended',
  CANCELED: 'canceled',
  DISPUTE: 'dispute',
  COMPLETE: 'complete',
} as const;

export type ProviderBackgroundCheckStatus =
  (typeof PROVIDER_BG_CHECK_STATUS)[keyof typeof PROVIDER_BG_CHECK_STATUS];

export interface ProviderBackgroundCheck {
  status: string;
  checkr_id?: string | null;
  report_url?: string | null;
  invitation_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export const backgroundCheckQueryKey = ['providerBackgroundCheck'] as const;

export function normalizeBackgroundCheckStatus(status: string | undefined | null): string {
  const s = (status ?? '').trim().toLowerCase();
  return s.length > 0 ? s : PROVIDER_BG_CHECK_STATUS.NOT_STARTED;
}

/** Human label — Checkr wording only. Never "Pass" / "Passed" / "PASS". */
export function formatBackgroundCheckStatus(status: string | undefined | null): string {
  switch (normalizeBackgroundCheckStatus(status)) {
    case 'not_started':
    case 'none':
      return 'Not started';
    case 'pending':
      return 'Pending';
    case 'clear':
      return 'Clear';
    case 'consider':
      return 'Consider';
    case 'suspended':
      return 'Suspended';
    case 'canceled':
    case 'cancelled':
      return 'Canceled';
    case 'dispute':
      return 'Dispute';
    case 'complete':
      return 'Complete (awaiting result)';
    default:
      return normalizeBackgroundCheckStatus(status).replaceAll('_', ' ');
  }
}

export function canStartBackgroundCheck(status: string | undefined | null): boolean {
  switch (normalizeBackgroundCheckStatus(status)) {
    case 'not_started':
    case 'none':
    case 'canceled':
    case 'cancelled':
    case 'suspended':
      return true;
    default:
      return false;
  }
}

export function backgroundCheckInvitationURL(
  row: ProviderBackgroundCheck | null | undefined,
): string | null {
  const raw = (row?.invitation_url ?? row?.report_url ?? '').trim();
  if (raw.startsWith('https://') || raw.startsWith('http://')) {
    return raw;
  }
  return null;
}

export function useBackgroundCheck(enabled = true) {
  return useQuery({
    queryKey: backgroundCheckQueryKey,
    enabled,
    queryFn: async (): Promise<ProviderBackgroundCheck> => {
      return api.get<ProviderBackgroundCheck>('/api/v1/providers/me/background-check');
    },
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 503 || error.status === 401)) {
        return false;
      }
      return failureCount < 1;
    },
  });
}

export function useStartBackgroundCheck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<ProviderBackgroundCheck>('/api/v1/providers/me/background-check', {}),
    onSuccess: (row) => {
      queryClient.setQueryData(backgroundCheckQueryKey, row);
    },
  });
}

export function backgroundCheckErrorMessage(err: unknown, fallback: string): string {
  return getApiErrorMessage(err, fallback);
}
