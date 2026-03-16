import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import type { Contract, ContractDetail, ContractsResponse, Milestone } from '@/types';

interface ContractsParams {
  status?: string;
  page?: number;
  page_size?: number;
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
    mutationFn: (id: string) =>
      api
        .post<{ contract: Contract }>(`/api/v1/contracts/${id}/accept`)
        .then((res) => res.contract),
    onSuccess: (_data, id) => {
      toast.success('Contract accepted');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: () => {
      toast.error('Failed to accept contract');
    },
  });
}

export function useStartWork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ contract: Contract }>(`/api/v1/contracts/${id}/start`).then((res) => res.contract),
    onSuccess: (_data, id) => {
      toast.success('Work started');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: () => {
      toast.error('Failed to start work');
    },
  });
}

export function useMarkComplete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api
        .post<{ contract: Contract }>(`/api/v1/contracts/${id}/complete`)
        .then((res) => res.contract),
    onSuccess: (_data, id) => {
      toast.success('Work marked as complete');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: () => {
      toast.error('Failed to mark work as complete');
    },
  });
}

export function useApproveCompletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api
        .post<{ contract: Contract }>(`/api/v1/contracts/${id}/approve-completion`)
        .then((res) => res.contract),
    onSuccess: (_data, id) => {
      toast.success('Completion approved — payment released');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: () => {
      toast.error('Failed to approve completion');
    },
  });
}

export function useCancelContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api
        .post<{ contract: Contract }>(`/api/v1/contracts/${id}/cancel`)
        .then((res) => res.contract),
    onSuccess: (_data, id) => {
      toast.success('Contract cancelled');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: () => {
      toast.error('Failed to cancel contract');
    },
  });
}

export function useSubmitMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { milestoneId: string; contractId: string }) =>
      api
        .post<{ milestone: Milestone }>(`/api/v1/milestones/${variables.milestoneId}/submit`)
        .then((res) => res.milestone),
    onSuccess: (_data, variables) => {
      toast.success('Milestone submitted for review');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
    onError: () => {
      toast.error('Failed to submit milestone');
    },
  });
}

export function useApproveMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { milestoneId: string; contractId: string }) =>
      api
        .post<{ milestone: Milestone }>(`/api/v1/milestones/${variables.milestoneId}/approve`)
        .then((res) => res.milestone),
    onSuccess: (_data, variables) => {
      toast.success('Milestone approved');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
    onError: () => {
      toast.error('Failed to approve milestone');
    },
  });
}

export function useRequestRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { milestoneId: string; contractId: string; revisionNotes: string }) =>
      api
        .post<{ milestone: Milestone }>(`/api/v1/milestones/${variables.milestoneId}/revision`, {
          revision_notes: variables.revisionNotes,
        })
        .then((res) => res.milestone),
    onSuccess: (_data, variables) => {
      toast.success('Revision requested');
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
    onError: () => {
      toast.error('Failed to request revision');
    },
  });
}
