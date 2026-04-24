import { useMemo } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';
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
    mutationFn: (input: CreateInstallmentPlanInput) =>
      api
        .post<{ plan: InstallmentPlan }>('/api/v1/payments/installment-plans', input)
        .then((res) => res.plan),
    onSuccess: () => {
      toast.success('Payment plan created');
      void queryClient.invalidateQueries({ queryKey: ['installment-plans'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: () => {
      toast.error('Failed to create payment plan');
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
