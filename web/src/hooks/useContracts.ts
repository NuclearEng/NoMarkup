import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  Contract,
  ContractDetail,
  ContractsResponse,
  Milestone,
} from '@/types';

interface ContractsParams {
  status?: string;
  page?: number;
  per_page?: number;
}

export function useContract(id: string) {
  return useQuery({
    queryKey: ['contract', id],
    queryFn: () => api.get<ContractDetail>(`/api/v1/contracts/${id}`),
    enabled: !!id,
  });
}

export function useContracts(params?: ContractsParams) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.per_page !== undefined) searchParams.set('per_page', String(params.per_page));
  const query = searchParams.toString();
  const path = `/api/v1/contracts${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['contracts', params?.status, params?.page, params?.per_page],
    queryFn: () => api.get<ContractsResponse>(path),
  });
}

export function useAcceptContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ contract: Contract }>(`/api/v1/contracts/${id}/accept`).then((res) => res.contract),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
  });
}

export function useStartWork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ contract: Contract }>(`/api/v1/contracts/${id}/start`).then((res) => res.contract),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
  });
}

export function useMarkComplete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ contract: Contract }>(`/api/v1/contracts/${id}/complete`).then((res) => res.contract),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
  });
}

export function useApproveCompletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ contract: Contract }>(`/api/v1/contracts/${id}/approve-completion`).then((res) => res.contract),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
  });
}

export function useCancelContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ contract: Contract }>(`/api/v1/contracts/${id}/cancel`).then((res) => res.contract),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
  });
}

export function useSubmitMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { milestoneId: string; contractId: string }) =>
      api.post<{ milestone: Milestone }>(`/api/v1/milestones/${variables.milestoneId}/submit`).then((res) => res.milestone),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
  });
}

export function useApproveMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { milestoneId: string; contractId: string }) =>
      api.post<{ milestone: Milestone }>(`/api/v1/milestones/${variables.milestoneId}/approve`).then((res) => res.milestone),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
  });
}

export function useRequestRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      milestoneId: string;
      contractId: string;
      revisionNotes: string;
    }) =>
      api
        .post<{ milestone: Milestone }>(`/api/v1/milestones/${variables.milestoneId}/revision`, {
          revision_notes: variables.revisionNotes,
        })
        .then((res) => res.milestone),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
    },
  });
}
