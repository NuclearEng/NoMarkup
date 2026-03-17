import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import type { AddEmployeeInput, CompanyEmployee } from '@/types';

interface EmployeesResponse {
  employees: CompanyEmployee[];
}

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      try {
        return await api.get<EmployeesResponse>('/api/v1/providers/me/employees');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });
}

export function useAddEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AddEmployeeInput) =>
      api
        .post<{ employee: CompanyEmployee }>('/api/v1/providers/me/employees', input)
        .then((res) => res.employee),
    onSuccess: () => {
      toast.success('Employee added');
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: () => {
      toast.error('Failed to add employee');
    },
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { id: string; data: Partial<AddEmployeeInput> & { status?: string } }) =>
      api
        .patch<{ employee: CompanyEmployee }>(
          `/api/v1/providers/me/employees/${variables.id}`,
          variables.data,
        )
        .then((res) => res.employee),
    onSuccess: () => {
      toast.success('Employee updated');
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: () => {
      toast.error('Failed to update employee');
    },
  });
}

export function useRemoveEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (employeeId: string) =>
      api.delete<{ success: boolean }>(`/api/v1/providers/me/employees/${employeeId}`),
    onSuccess: () => {
      toast.success('Employee removed');
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: () => {
      toast.error('Failed to remove employee');
    },
  });
}
