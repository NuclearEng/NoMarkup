import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import { isAcceptanceExpired } from '@/lib/utils';
import type { Contract, ContractDetail, ContractsResponse, Dispute, Milestone } from '@/types';

/**
 * Hydration-safe check for whether a contract's acceptance window has closed
 * (status still `pending_acceptance` AND `acceptance_deadline` in the past).
 *
 * Returns `false` until mounted so the SSR render and the first client render
 * agree (no `Date.now()` in the initial render → no hydration mismatch — same
 * mounted-guard pattern as `AcceptanceCountdown` / `useCountdown`). After mount
 * it reflects real time and re-checks once per minute so a contract that
 * crosses its deadline while the page is open flips to expired on its own.
 */
export function useAcceptanceExpired(
  status: string,
  acceptanceDeadline: string | null | undefined,
): boolean {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 60000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  if (nowMs === null) return false;
  return isAcceptanceExpired(status, acceptanceDeadline, nowMs);
}

interface ContractsParams {
  status?: string;
  page?: number;
  page_size?: number;
}

// Gateway contract handlers return the contract object at the top level
// (not wrapped in { contract }). This helper centralizes the unwrap so the
// mutation hooks keep their { contract } contract-shaped return type.
async function postContract(path: string): Promise<Contract> {
  const raw = await api.post<Record<string, unknown>>(path);
  return raw as unknown as Contract;
}

// Milestone mutations have the same flat-shape behavior.
async function postMilestone(path: string, body?: unknown): Promise<Milestone> {
  const raw = await api.post<Record<string, unknown>>(path, body);
  return raw as unknown as Milestone;
}

function explainFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      toast.error(err.userMessage(fallback));
      return;
    }
    toast.error(fallback);
  };
}

export function useContract(id: string) {
  return useQuery({
    queryKey: ['contract', id],
    queryFn: async () => {
      const raw = await api.get<Record<string, unknown>>(`/api/v1/contracts/${id}`);
      // The gateway returns a flat contract object with change_orders embedded.
      // Normalize to { contract, change_orders } to match ContractDetail type.
      const { change_orders, ...contractFields } = raw;
      return {
        contract: contractFields as unknown as Contract,
        change_orders: (change_orders ?? []) as ContractDetail['change_orders'],
      };
    },
    enabled: !!id,
  });
}

export function useContracts(params?: ContractsParams) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const query = searchParams.toString();
  const path = `/api/v1/contracts${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['contracts', params?.status, params?.page, params?.page_size],
    queryFn: () => api.get<ContractsResponse>(path),
  });
}

export function useAcceptContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postContract(`/api/v1/contracts/${id}/accept`),
    onSuccess: (_data, id) => {
      toast.success('Contract accepted');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: explainFailure('Failed to accept contract'),
  });
}

export function useStartWork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postContract(`/api/v1/contracts/${id}/start`),
    onSuccess: (_data, id) => {
      toast.success('Work started');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: explainFailure('Failed to start work'),
  });
}

export function useMarkComplete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postContract(`/api/v1/contracts/${id}/complete`),
    onSuccess: (_data, id) => {
      toast.success('Work marked as complete');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: explainFailure('Failed to mark work as complete'),
  });
}

export function useApproveCompletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postContract(`/api/v1/contracts/${id}/approve-completion`),
    onSuccess: (_data, id) => {
      toast.success('Completion approved. Release escrow separately if funds are still held.');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: explainFailure('Failed to approve completion'),
  });
}

export function useCancelContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => postContract(`/api/v1/contracts/${id}/cancel`),
    onSuccess: (_data, id) => {
      toast.success('Contract cancelled');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: explainFailure('Failed to cancel contract'),
  });
}

export function useSubmitMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { milestoneId: string; contractId: string }) =>
      postMilestone(`/api/v1/milestones/${variables.milestoneId}/submit`),
    onSuccess: (_data, variables) => {
      toast.success('Milestone submitted for review');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
    onError: explainFailure('Failed to submit milestone'),
  });
}

export function useApproveMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { milestoneId: string; contractId: string }) =>
      postMilestone(`/api/v1/milestones/${variables.milestoneId}/approve`),
    onSuccess: (_data, variables) => {
      toast.success('Milestone approved');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
    onError: explainFailure('Failed to approve milestone'),
  });
}

export function useRequestRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { milestoneId: string; contractId: string; revisionNotes: string }) =>
      postMilestone(`/api/v1/milestones/${variables.milestoneId}/revision`, {
        revision_notes: variables.revisionNotes,
      }),
    onSuccess: (_data, variables) => {
      toast.success('Revision requested');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
    onError: explainFailure('Failed to request revision'),
  });
}

export function useProposeChangeOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      contractId: string;
      description: string;
      amount_delta_cents: number;
    }) =>
      api.post<Record<string, unknown>>(
        `/api/v1/contracts/${variables.contractId}/change-orders`,
        {
          description: variables.description,
          amount_delta_cents: variables.amount_delta_cents,
        },
      ),
    onSuccess: (_data, variables) => {
      toast.success('Change order proposed');
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
    onError: explainFailure('Failed to propose change order'),
  });
}

export function useRespondToChangeOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      contractId: string;
      changeOrderId: string;
      accepted: boolean;
    }) =>
      api.put<Record<string, unknown>>(
        `/api/v1/contracts/${variables.contractId}/change-orders/${variables.changeOrderId}`,
        { accepted: variables.accepted },
      ),
    onSuccess: (_data, variables) => {
      toast.success(variables.accepted ? 'Change order approved' : 'Change order rejected');
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
    onError: explainFailure('Failed to respond to change order'),
  });
}

export function useOpenDispute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      contractId: string;
      dispute_type: string;
      description: string;
      is_guarantee_claim?: boolean;
    }) =>
      api.post<{ dispute: Dispute }>(`/api/v1/contracts/${variables.contractId}/disputes`, {
        dispute_type: variables.dispute_type,
        description: variables.description,
        is_guarantee_claim: variables.is_guarantee_claim ?? false,
      }),
    onSuccess: (_data, variables) => {
      toast.success('Claim submitted successfully');
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
    onError: explainFailure('Failed to submit claim'),
  });
}
