import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  AdminDisputesResponse,
  AdminFlaggedReviewsResponse,
  AdminJobSearchParams,
  AdminJobsResponse,
  AdminPaymentSearchParams,
  AdminPaymentsResponse,
  AdminSearchParams,
  AdminUser,
  AdminUsersResponse,
  CategoryMetricsResponse,
  Dispute,
  FeeConfig,
  GrowthMetrics,
  Payment,
  PaginationResponse,
  PlatformMetrics,
  RevenueReport,
  VerificationDocument,
} from '@/types';

// ─── Query key factories ──────────────────────────────

const adminKeys = {
  all: ['admin'] as const,
  users: (params?: AdminSearchParams) => [...adminKeys.all, 'users', params] as const,
  user: (id: string) => [...adminKeys.all, 'users', id] as const,
  verification: (page?: number, pageSize?: number) =>
    [...adminKeys.all, 'verification', page, pageSize] as const,
  jobs: (params?: AdminJobSearchParams) => [...adminKeys.all, 'jobs', params] as const,
  disputes: (params?: { status?: string; page?: number; page_size?: number }) =>
    [...adminKeys.all, 'disputes', params] as const,
  dispute: (id: string) => [...adminKeys.all, 'disputes', id] as const,
  flaggedReviews: (params?: { status?: string; page?: number; page_size?: number }) =>
    [...adminKeys.all, 'reviews', 'flagged', params] as const,
  payments: (params?: AdminPaymentSearchParams) =>
    [...adminKeys.all, 'payments', params] as const,
  payment: (id: string) => [...adminKeys.all, 'payments', id] as const,
  revenue: (startDate?: string, endDate?: string, groupBy?: string) =>
    [...adminKeys.all, 'revenue', startDate, endDate, groupBy] as const,
  platformMetrics: (startDate?: string, endDate?: string) =>
    [...adminKeys.all, 'platform', 'metrics', startDate, endDate] as const,
  growthMetrics: (startDate?: string, endDate?: string, groupBy?: string) =>
    [...adminKeys.all, 'platform', 'growth', startDate, endDate, groupBy] as const,
  categoryMetrics: (startDate?: string, endDate?: string) =>
    [...adminKeys.all, 'platform', 'categories', startDate, endDate] as const,
};

// ─── Helper to build query strings ───────────────────

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

// ─── Users ────────────────────────────────────────────

export function useAdminUsers(params?: AdminSearchParams) {
  const query = buildQuery({
    query: params?.query,
    status: params?.status,
    role: params?.role,
    page: params?.page,
    page_size: params?.page_size,
  });

  return useQuery({
    queryKey: adminKeys.users(params),
    queryFn: () => api.get<AdminUsersResponse>(`/api/v1/admin/users${query}`),
  });
}

export function useAdminUser(userId: string) {
  return useQuery({
    queryKey: adminKeys.user(userId),
    queryFn: () => api.get<{ user: AdminUser }>(`/api/v1/admin/users/${userId}`),
    enabled: !!userId,
  });
}

export function useSuspendUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { userId: string; reason: string }) =>
      api.post<{ user: AdminUser }>(
        `/api/v1/admin/users/${variables.userId}/suspend`,
        { reason: variables.reason },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all });
    },
  });
}

export function useBanUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { userId: string; reason: string }) =>
      api.post<{ user: AdminUser }>(
        `/api/v1/admin/users/${variables.userId}/ban`,
        { reason: variables.reason },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all });
    },
  });
}

// ─── Verification ─────────────────────────────────────

export function useVerificationQueue(page?: number, pageSize?: number) {
  const query = buildQuery({ page, page_size: pageSize });

  return useQuery({
    queryKey: adminKeys.verification(page, pageSize),
    queryFn: () =>
      api.get<{ documents: VerificationDocument[]; pagination: PaginationResponse }>(
        `/api/v1/admin/verification/queue${query}`,
      ),
  });
}

export function useReviewDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      documentId: string;
      approved: boolean;
      rejection_reason?: string;
    }) =>
      api.post<{ document: VerificationDocument }>(
        `/api/v1/admin/verification/${variables.documentId}/review`,
        {
          approved: variables.approved,
          rejection_reason: variables.rejection_reason,
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...adminKeys.all, 'verification'],
      });
    },
  });
}

// ─── Jobs ─────────────────────────────────────────────

export function useAdminJobs(params?: AdminJobSearchParams) {
  const query = buildQuery({
    status: params?.status,
    customer_id: params?.customer_id,
    category_id: params?.category_id,
    page: params?.page,
    page_size: params?.page_size,
  });

  return useQuery({
    queryKey: adminKeys.jobs(params),
    queryFn: () => api.get<AdminJobsResponse>(`/api/v1/admin/jobs${query}`),
  });
}

export function useSuspendJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { jobId: string; reason: string }) =>
      api.post(`/api/v1/admin/jobs/${variables.jobId}/suspend`, {
        reason: variables.reason,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'jobs'] });
    },
  });
}

export function useRemoveJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { jobId: string; reason: string }) =>
      api.post(`/api/v1/admin/jobs/${variables.jobId}/remove`, {
        reason: variables.reason,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'jobs'] });
    },
  });
}

// ─── Disputes ─────────────────────────────────────────

export function useAdminDisputes(params?: {
  status?: string;
  page?: number;
  page_size?: number;
}) {
  const query = buildQuery({
    status: params?.status,
    page: params?.page,
    page_size: params?.page_size,
  });

  return useQuery({
    queryKey: adminKeys.disputes(params),
    queryFn: () => api.get<AdminDisputesResponse>(`/api/v1/admin/disputes${query}`),
  });
}

export function useAdminDispute(disputeId: string) {
  return useQuery({
    queryKey: adminKeys.dispute(disputeId),
    queryFn: () => api.get<{ dispute: Dispute }>(`/api/v1/admin/disputes/${disputeId}`),
    enabled: !!disputeId,
  });
}

export function useResolveDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      disputeId: string;
      resolution_type: string;
      resolution_notes: string;
      refund_amount_cents?: number;
      guarantee_claim?: boolean;
    }) =>
      api.post(`/api/v1/admin/disputes/${variables.disputeId}/resolve`, {
        resolution_type: variables.resolution_type,
        resolution_notes: variables.resolution_notes,
        refund_amount_cents: variables.refund_amount_cents,
        guarantee_claim: variables.guarantee_claim,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...adminKeys.all, 'disputes'],
      });
    },
  });
}

// ─── Reviews ──────────────────────────────────────────

export function useAdminFlaggedReviews(params?: {
  status?: string;
  page?: number;
  page_size?: number;
}) {
  const query = buildQuery({
    status: params?.status,
    page: params?.page,
    page_size: params?.page_size,
  });

  return useQuery({
    queryKey: adminKeys.flaggedReviews(params),
    queryFn: () =>
      api.get<AdminFlaggedReviewsResponse>(`/api/v1/admin/reviews/flagged${query}`),
  });
}

export function useResolveReviewFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { flagId: string; action: string; notes: string }) =>
      api.post(`/api/v1/admin/reviews/flags/${variables.flagId}/resolve`, {
        action: variables.action,
        notes: variables.notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...adminKeys.all, 'reviews'],
      });
    },
  });
}

export function useRemoveReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { reviewId: string; reason: string }) =>
      api.delete(`/api/v1/admin/reviews/${variables.reviewId}`, {
        reason: variables.reason,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...adminKeys.all, 'reviews'],
      });
    },
  });
}

// ─── Payments ─────────────────────────────────────────

export function useAdminPayments(params?: AdminPaymentSearchParams) {
  const query = buildQuery({
    user_id: params?.user_id,
    status: params?.status,
    start_date: params?.start_date,
    end_date: params?.end_date,
    page: params?.page,
    page_size: params?.page_size,
  });

  return useQuery({
    queryKey: adminKeys.payments(params),
    queryFn: () => api.get<AdminPaymentsResponse>(`/api/v1/admin/payments${query}`),
  });
}

export function useAdminPaymentDetails(paymentId: string) {
  return useQuery({
    queryKey: adminKeys.payment(paymentId),
    queryFn: () => api.get<{ payment: Payment }>(`/api/v1/admin/payments/${paymentId}`),
    enabled: !!paymentId,
  });
}

export function useRevenueReport(startDate?: string, endDate?: string, groupBy?: string) {
  const query = buildQuery({
    start_date: startDate,
    end_date: endDate,
    group_by: groupBy,
  });

  return useQuery({
    queryKey: adminKeys.revenue(startDate, endDate, groupBy),
    queryFn: () => api.get<RevenueReport>(`/api/v1/admin/revenue${query}`),
  });
}

export function useUpdateFeeConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: FeeConfig) => api.put<FeeConfig>('/api/v1/admin/fees', config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all });
    },
  });
}

// ─── Platform Metrics ─────────────────────────────────

export function usePlatformMetrics(startDate?: string, endDate?: string) {
  const query = buildQuery({ start_date: startDate, end_date: endDate });

  return useQuery({
    queryKey: adminKeys.platformMetrics(startDate, endDate),
    queryFn: () => api.get<PlatformMetrics>(`/api/v1/admin/platform/metrics${query}`),
  });
}

export function useGrowthMetrics(
  startDate?: string,
  endDate?: string,
  groupBy?: string,
) {
  const query = buildQuery({
    start_date: startDate,
    end_date: endDate,
    group_by: groupBy,
  });

  return useQuery({
    queryKey: adminKeys.growthMetrics(startDate, endDate, groupBy),
    queryFn: () => api.get<GrowthMetrics>(`/api/v1/admin/platform/growth${query}`),
  });
}

export function useCategoryMetrics(startDate?: string, endDate?: string) {
  const query = buildQuery({ start_date: startDate, end_date: endDate });

  return useQuery({
    queryKey: adminKeys.categoryMetrics(startDate, endDate),
    queryFn: () =>
      api.get<CategoryMetricsResponse>(`/api/v1/admin/platform/categories${query}`),
  });
}
