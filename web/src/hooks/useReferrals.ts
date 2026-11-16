/**
 * useReferrals — queries and mutations for the referral program.
 *
 * Wires up the gateway endpoints from /api/v1/me/referrals/* (handler at
 * gateway/internal/handler/referrals.go). The /code endpoint lazily
 * generates a code on first hit so calling useReferralCode() at any
 * point in the dashboard guarantees a code exists.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';

export interface ReferralCode {
  code: string;
  credit_cents: number;
  share_url: string;
  share_message: string;
}

export interface ReferralEntry {
  id: string;
  status: string;
  referred_id?: string;
  credit_cents: number;
  credited_at?: string;
  created_at: string;
}

export interface ReferralList {
  code: string;
  referrals: ReferralEntry[];
  credit_balance_cents: number;
}

export function useReferralCode() {
  return useQuery({
    queryKey: ['referrals', 'code'],
    queryFn: () => api.get<ReferralCode>('/api/v1/me/referrals/code'),
    staleTime: 60_000,
  });
}

export function useMyReferrals() {
  return useQuery({
    queryKey: ['referrals', 'list'],
    queryFn: () => api.get<ReferralList>('/api/v1/me/referrals'),
    staleTime: 30_000,
  });
}

export function useRedeemReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api.post<{ redeemed: boolean; credit_cents: number; message: string }>(
        '/api/v1/me/referrals/redeem',
        { code },
      ),
    onSuccess: (data) => {
      toast.success(data.message);
      void qc.invalidateQueries({ queryKey: ['referrals'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to redeem code'));
    },
  });
}
