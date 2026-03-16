import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import type { ExpensesResponse, ProviderExpense } from '@/types';

interface ExpenseParams {
  category?: string;
  start_date?: string;
  end_date?: string;
}

export function useExpenses(params?: ExpenseParams) {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.start_date) searchParams.set('start_date', params.start_date);
  if (params?.end_date) searchParams.set('end_date', params.end_date);
  const query = searchParams.toString();
  const path = `/api/v1/providers/me/expenses${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['expenses', params?.category, params?.start_date, params?.end_date],
    queryFn: async () => {
      try {
        return await api.get<ExpensesResponse>(path);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) return null;
        throw error;
      }
    },
    retry: false,
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      category: string;
      description: string;
      amount_cents: number;
      receipt_url?: string;
      expense_date: string;
    }) =>
      api
        .post<{ expense: ProviderExpense }>('/api/v1/providers/me/expenses', variables)
        .then((res) => res.expense),
    onSuccess: () => {
      toast.success('Expense added');
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => {
      toast.error('Failed to add expense');
    },
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (expenseId: string) =>
      api.delete<{ success: boolean }>(`/api/v1/providers/me/expenses/${expenseId}`),
    onSuccess: () => {
      toast.success('Expense deleted');
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => {
      toast.error('Failed to delete expense');
    },
  });
}
