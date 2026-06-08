import { useMemo } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';
import { useContract } from '@/hooks/useContracts';
import { usePayments } from '@/hooks/usePayments';
import type {
  CreateInstallmentPlanInput,
  InstallmentInfo,
  InstallmentPlan,
  InstallmentPlansResponse,
} from '@/types';

export function useInstallmentSchedule(contractId: string) {
  const { data: contractData, isLoading: contractLoading } = useContract(contractId);
  const { data: paymentsData, isLoading: paymentsLoading } = usePayments({ status: undefined });

  const installments = useMemo<InstallmentInfo[]>(() => {
    if (!contractData || !paymentsData) return [];

    const contract = contractData.contract;

    // Filter payments for this contract that have installment info
    const contractPayments = paymentsData.payments.filter(
      (p) =>
        p.contract_id === contractId &&
        p.installment_number !== undefined &&
        p.total_installments !== undefined &&
        p.total_installments > 1,
    );

    if (contractPayments.length === 0) return [];

    const totalInstallments = contractPayments[0]?.total_installments ?? 0;
    if (totalInstallments === 0) return [];

    const result: InstallmentInfo[] = [];
    for (let i = 1; i <= totalInstallments; i++) {
      const payment = contractPayments.find((p) => p.installment_number === i);
      result.push({
        installment_number: i,
        total_installments: totalInstallments,
        amount_cents: payment?.amount_cents ?? Math.round(contract.amount_cents / totalInstallments),
        status: payment?.status ?? 'upcoming',
        due_date: payment?.created_at,
        paid_at: payment?.completed_at ?? undefined,
      });
    }

    return result;
  }, [contractData, paymentsData, contractId]);

  return {
    installments,
    isLoading: contractLoading || paymentsLoading,
  };
}

export function useCreateInstallmentPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    // The gateway's RequireIdempotencyKey middleware 400s any payment POST that
    // lacks the Idempotency-Key HEADER (separate from the body's idempotency_key
    // field, which the handler also requires). Send both, derived from the same
    // per-call UUID so a retried request dedupes correctly.
    mutationFn: (input: CreateInstallmentPlanInput) =>
      api
        .post<{ plan: InstallmentPlan }>(
          '/api/v1/payments/installment-plans',
          input,
          { 'Idempotency-Key': input.idempotency_key },
        )
        .then((res) => res.plan),
    onSuccess: () => {
      toast.success('Payment plan created');
      void queryClient.invalidateQueries({ queryKey: ['installment-plans'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to create payment plan'));
    },
  });
}

export function useInstallmentPlan(id: string) {
  return useQuery({
    queryKey: ['installment-plan', id],
    // Gateway returns the plan at the top level — wrap to preserve consumer shape.
    queryFn: async () => {
      const raw = await api.get<InstallmentPlan>(`/api/v1/payments/installment-plans/${id}`);
      return { plan: raw };
    },
    enabled: !!id,
  });
}

export function useMyInstallmentPlans() {
  return useQuery({
    queryKey: ['installment-plans'],
    queryFn: () => api.get<InstallmentPlansResponse>('/api/v1/payments/installment-plans'),
  });
}

/**
 * Whether the current user already has an installment plan for `contractId`.
 *
 * Used by the contract page to decide between the BNPL *selector* (no plan yet)
 * and the *schedule* (plan exists). Reads the same `['installment-plans']` cache
 * key the create mutation invalidates, so a freshly-created plan flips this to
 * `true` without a manual refetch.
 *
 * Normalizes the list response: the gateway returns `{ installment_plans: [] }`
 * while the typed `InstallmentPlansResponse` shape uses `{ plans: [] }` — accept
 * either so detection is correct against the live API and the typed contract.
 */
export function useContractInstallmentPlan(contractId: string) {
  const { data, isLoading } = useMyInstallmentPlans();

  const plan = useMemo<InstallmentPlan | undefined>(() => {
    if (!data) return undefined;
    const list =
      (data as { plans?: InstallmentPlan[] }).plans ??
      (data as unknown as { installment_plans?: InstallmentPlan[] }).installment_plans ??
      [];
    return list.find((p) => p.contract_id === contractId);
  }, [data, contractId]);

  return { plan, hasPlan: !!plan, isLoading };
}
