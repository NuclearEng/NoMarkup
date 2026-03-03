import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  AlertStatus,
  FraudAlert,
  FraudAlertsResponse,
  ReviewAlertInput,
  RiskLevel,
  UserRiskProfile,
} from '@/types';

interface FraudAlertsParams {
  status?: AlertStatus;
  risk_level?: RiskLevel;
  page?: number;
  pageSize?: number;
}

export function useFraudAlerts(params?: FraudAlertsParams) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.risk_level) searchParams.set('risk_level', params.risk_level);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.pageSize !== undefined) searchParams.set('page_size', String(params.pageSize));
  const query = searchParams.toString();
  const path = `/api/v1/admin/fraud/alerts${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['fraud-alerts', params?.status, params?.risk_level, params?.page, params?.pageSize],
    queryFn: () => api.get<FraudAlertsResponse>(path),
  });
}

export function useReviewFraudAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { alertId: string; input: ReviewAlertInput }) =>
      api
        .post<{ alert: FraudAlert }>(
          `/api/v1/admin/fraud/alerts/${variables.alertId}/review`,
          variables.input,
        )
        .then((res) => res.alert),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fraud-alerts'] });
    },
  });
}

export function useUserRiskProfile(userId: string) {
  return useQuery({
    queryKey: ['user-risk-profile', userId],
    queryFn: () => api.get<UserRiskProfile>(`/api/v1/admin/fraud/users/${userId}/risk`),
    enabled: !!userId,
  });
}
