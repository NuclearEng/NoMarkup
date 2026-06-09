import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage, idempotencyHeader } from '@/lib/api';
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
  CreatePlatformBankAccountInput,
  Dispute,
  FeeConfig,
  FeeConfigSummary,
  GrowthMetrics,
  Market,
  Payment,
  PaginationResponse,
  PlatformBankAccount,
  PlatformBankingResponse,
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
  feeConfig: (categoryId?: string) =>
    [...adminKeys.all, 'fee-config', categoryId] as const,
  platformMetrics: (startDate?: string, endDate?: string) =>
    [...adminKeys.all, 'platform', 'metrics', startDate, endDate] as const,
  growthMetrics: (startDate?: string, endDate?: string, groupBy?: string) =>
    [...adminKeys.all, 'platform', 'growth', startDate, endDate, groupBy] as const,
  categoryMetrics: (startDate?: string, endDate?: string) =>
    [...adminKeys.all, 'platform', 'categories', startDate, endDate] as const,
  banking: () => [...adminKeys.all, 'banking'] as const,
  flags: () => [...adminKeys.all, 'flags'] as const,
  insurers: () => [...adminKeys.all, 'insurers'] as const,
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
    // Gateway returns { status: string } — the document body isn't echoed back.
    // The page only needs to invalidate the queue on success, so we don't need
    // the full document here.
    mutationFn: (variables: {
      documentId: string;
      approved: boolean;
      rejection_reason?: string;
    }) =>
      api.post<{ status: string }>(
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
    // The admin form has a checkbox (`guarantee_claim: boolean`) but the
    // gateway/contract service expects a `guarantee_outcome` string. Map the
    // boolean to "approved" / empty so the backend records the outcome.
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
        guarantee_outcome: variables.guarantee_claim ? 'approved' : '',
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

// useFeeConfig reads the currently ACTIVE fee configuration (GET, read-only) so
// the admin can see the live rates at a glance. Percentages come back as 0..1
// fractions and bounds as integer cents — the consuming UI formats them. An
// optional categoryId fetches a category override; default (no arg) is the
// platform-wide config.
export function useFeeConfig(categoryId?: string) {
  const query = buildQuery({ category_id: categoryId });
  return useQuery({
    queryKey: adminKeys.feeConfig(categoryId),
    queryFn: () =>
      api.get<FeeConfigSummary>(`/api/v1/admin/payments/fee-config${query}`),
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

// ─── Platform Banking ─────────────────────────────────
//
// The platform payout bank account — where all collected fees route. Admin
// only. Raw account/routing numbers are tokenized client-side with Stripe.js;
// only the resulting bank-account token (btok_...) ever reaches our backend.

export function usePlatformBanking() {
  return useQuery({
    queryKey: adminKeys.banking(),
    queryFn: () => api.get<PlatformBankingResponse>('/api/v1/admin/banking'),
  });
}

export function useSetPlatformBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlatformBankAccountInput) =>
      // Idempotent — guards against double-submits creating duplicate accounts.
      api.post<{ account: PlatformBankAccount }>(
        '/api/v1/admin/banking',
        input,
        idempotencyHeader(),
      ),
    onSuccess: () => {
      toast.success('Platform bank account saved');
      void queryClient.invalidateQueries({ queryKey: adminKeys.banking() });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to save bank account'));
    },
  });
}

export function useDeletePlatformBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      api.delete<{ deleted: boolean }>(`/api/v1/admin/banking/${accountId}`),
    onSuccess: () => {
      toast.success('Platform bank account removed');
      void queryClient.invalidateQueries({ queryKey: adminKeys.banking() });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to remove bank account'));
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

// ─── Marketplace listings (goods) ─────────────────────
//
// The marketplace admin surface is pgx-direct (no gRPC); response shapes
// are inlined here rather than exported from /types so each consumer can
// see the JSON contract at a glance.

export interface AdminListing {
  id: string;
  title: string;
  seller_id: string;
  seller_email: string;
  status: string;
  is_hidden: boolean;
  hidden_reason?: string | null;
  starting_price_cents: number;
  current_bid_cents?: number | null;
  bid_count: number;
  open_report_count: number;
  auction_ends_at: string;
  created_at: string;
}

export interface AdminListingsResponse {
  listings: AdminListing[];
  pagination: { page: number; page_size: number; total: number };
}

export function useAdminListings(params?: {
  q?: string;
  status?: string;
  seller_id?: string;
  hidden?: 'true' | 'false';
  page?: number;
  page_size?: number;
}) {
  const query = buildQuery({
    q: params?.q,
    status: params?.status,
    seller_id: params?.seller_id,
    hidden: params?.hidden,
    page: params?.page,
    page_size: params?.page_size,
  });
  return useQuery({
    queryKey: ['admin', 'listings', params],
    queryFn: () => api.get<AdminListingsResponse>(`/api/v1/admin/listings${query}`),
  });
}

export function useSuspendListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { listingId: string; reason: string }) =>
      api.post(`/api/v1/admin/listings/${vars.listingId}/suspend`, { reason: vars.reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'listings'] });
    },
  });
}

export function useReactivateListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { listingId: string }) =>
      api.post(`/api/v1/admin/listings/${vars.listingId}/reactivate`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'listings'] });
    },
  });
}

export function useCancelListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { listingId: string; reason: string }) =>
      api.post(`/api/v1/admin/listings/${vars.listingId}/cancel`, { reason: vars.reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'listings'] });
    },
  });
}

// ─── Goods reports ────────────────────────────────────

export interface AdminReport {
  id: string;
  listing_id: string;
  listing_title: string;
  reporter_id?: string | null;
  reporter_email?: string | null;
  reason: string;
  description: string;
  status: string;
  resolution?: string | null;
  created_at: string;
  reviewed_at?: string | null;
}

export interface AdminReportsResponse {
  reports: AdminReport[];
  pagination: { page: number; page_size: number; total: number };
}

export function useAdminReports(params?: {
  status?: string;
  listing_id?: string;
  page?: number;
  page_size?: number;
}) {
  const query = buildQuery({
    status: params?.status,
    listing_id: params?.listing_id,
    page: params?.page,
    page_size: params?.page_size,
  });
  return useQuery({
    queryKey: ['admin', 'goods-reports', params],
    queryFn: () => api.get<AdminReportsResponse>(`/api/v1/admin/goods-reports${query}`),
  });
}

export function useResolveReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { reportId: string; action: 'dismiss' | 'actioned' | 'review'; notes: string }) =>
      api.post(`/api/v1/admin/goods-reports/${vars.reportId}/resolve`, {
        action: vars.action,
        notes: vars.notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'goods-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'listings'] });
    },
  });
}

// ─── Markets (rollout) ────────────────────────────────
//
// The market catalog (cities/regions) admin surface. Launching a market sets
// is_active=true, making it publicly browseable; pulling back sets it false.
// On any change we invalidate BOTH the admin catalog (['admin','markets']) and
// the public selector cache (['markets'] — see useMarkets.ts) so the live
// MarketSelector reflects the change immediately.

export function useAdminMarkets() {
  return useQuery({
    queryKey: ['admin', 'markets'],
    queryFn: () => api.get<{ markets: Market[] }>('/api/v1/admin/markets'),
  });
}

export interface SetMarketsActiveInput {
  /** Explicit market slugs to target. */
  slugs?: string[];
  /** 2-letter US state code (region) to target in bulk. */
  region_code?: string;
  /** Country to target in bulk. */
  country?: 'US' | 'MX';
  /** true launches the selected markets, false pulls them back. */
  active: boolean;
}

export function useSetMarketsActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetMarketsActiveInput) =>
      api.post<{ updated: number; active: boolean }>(
        '/api/v1/admin/markets/activate',
        input,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] });
      void queryClient.invalidateQueries({ queryKey: ['markets'] });
    },
  });
}

// ─── Goods disputes ───────────────────────────────────

export interface AdminGoodsDispute {
  id: string;
  listing_order_id: string;
  listing_id: string;
  listing_title: string;
  opened_by: string;
  opened_by_email: string;
  dispute_type: string;
  description: string;
  status: string;
  amount_cents: number;
  refund_to_buyer_cents?: number | null;
  transfer_to_seller_cents?: number | null;
  created_at: string;
  resolved_at?: string | null;
}

export function useAdminGoodsDisputes(params?: {
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
    queryKey: ['admin', 'goods-disputes', params],
    queryFn: () =>
      api.get<{
        disputes: AdminGoodsDispute[];
        pagination: { page: number; page_size: number; total: number };
      }>(`/api/v1/admin/disputes/goods${query}`),
  });
}

export function useResolveGoodsDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      disputeId: string;
      resolution: 'refund_full' | 'refund_partial' | 'release_to_seller' | 'no_action';
      refund_to_buyer_cents?: number;
      transfer_to_seller_cents?: number;
      notes: string;
    }) =>
      api.post(`/api/v1/admin/disputes/goods/${vars.disputeId}/resolve`, {
        resolution: vars.resolution,
        refund_to_buyer_cents: vars.refund_to_buyer_cents ?? 0,
        transfer_to_seller_cents: vars.transfer_to_seller_cents ?? 0,
        notes: vars.notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'goods-disputes'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'listings'] });
    },
  });
}

// ─── Feature flags ────────────────────────────────────
//
// Gateway-level flags stored directly in PostgreSQL (no gRPC service). The
// list endpoint returns full metadata for the admin dashboard; the update
// endpoint flips a single flag's enabled state by key. Toggling a flag here
// changes what the public `/api/v1/flags` map (useFeatureFlags) returns, so on
// success we invalidate both the admin list and the public flag cache.

export interface AdminFeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
  updated_at: string;
}

export interface AdminFeatureFlagsResponse {
  flags: AdminFeatureFlag[];
}

export function useAdminFlags() {
  return useQuery({
    queryKey: adminKeys.flags(),
    queryFn: () => api.get<AdminFeatureFlagsResponse>('/api/v1/admin/flags'),
  });
}

export function useToggleFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string; enabled: boolean }) =>
      api.put<{ key: string; enabled: boolean }>(
        `/api/v1/admin/flags/${vars.key}`,
        { enabled: vars.enabled },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.flags() });
      // The public flag map (useFeatureFlags) is now stale — refresh it so the
      // live UI reflects the toggle without a hard reload.
      void queryClient.invalidateQueries({ queryKey: ['feature-flags'] });
    },
  });
}

// ─── Insurers (competitive insurance marketplace) ─────
//
// Admin onboarding + approval surface for the competitive insurance
// marketplace. Insurers are onboarded with a rate card (one row per product
// type), then approved/suspended by an admin. Rates are stored as integer
// basis points (1% = 100 bps) and premiums as integer cents — the UI formats
// them. This is a pgx-direct admin surface; response shapes are inlined here
// so each consumer sees the JSON contract at a glance.

export const INSURER_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  SUSPENDED: 'suspended',
} as const;

export type InsurerStatus = (typeof INSURER_STATUS)[keyof typeof INSURER_STATUS];

// Values must match what carriers offer (insurer_products, migration 063) + the
// per-job insurance taxonomy, so admin-created products are queryable by the
// quote fan-out. 'workmanship'/'completion' previously did NOT match the seeded
// 'workmanship_warranty'/'completion_guarantee'.
export const INSURANCE_PRODUCT_TYPE = {
  PROPERTY_DAMAGE: 'property_damage',
  WORKMANSHIP: 'workmanship_warranty',
  COMPLETION: 'completion_guarantee',
  LIABILITY: 'liability',
} as const;

export type InsuranceProductType =
  (typeof INSURANCE_PRODUCT_TYPE)[keyof typeof INSURANCE_PRODUCT_TYPE];

export interface InsurerProduct {
  id: string;
  product_type: InsuranceProductType;
  base_rate_bps: number;
  min_premium_cents: number;
  active: boolean;
}

export interface Insurer {
  id: string;
  name: string;
  slug: string;
  status: InsurerStatus;
  products: InsurerProduct[];
  created_at: string;
}

export interface AdminInsurersResponse {
  insurers: Insurer[];
}

/** A single rate-card row in the onboarding payload (no id/active yet). */
export interface OnboardInsurerProduct {
  product_type: InsuranceProductType;
  base_rate_bps: number;
  min_premium_cents: number;
}

export interface OnboardInsurerInput {
  name: string;
  slug: string;
  products: OnboardInsurerProduct[];
}

export interface UpdateInsurerInput {
  id: string;
  status?: InsurerStatus;
  products?: OnboardInsurerProduct[];
}

export function useAdminInsurers() {
  return useQuery({
    queryKey: adminKeys.insurers(),
    queryFn: () => api.get<AdminInsurersResponse>('/api/v1/admin/insurers'),
  });
}

export function useOnboardInsurer() {
  const queryClient = useQueryClient();
  return useMutation({
    // The gateway reads the rate card under `rate_card` (createInsurerRequest);
    // sending `products` silently drops every row, onboarding a carrier that can
    // never quote. Map the UI's `products` to the wire field here.
    mutationFn: ({ products, ...rest }: OnboardInsurerInput) =>
      api.post<{ insurer: Insurer }>('/api/v1/admin/insurers', {
        ...rest,
        rate_card: products,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.insurers() });
    },
  });
}

export function useUpdateInsurer() {
  const queryClient = useQueryClient();
  return useMutation({
    // Same wire-field mapping as onboarding: the gateway upserts the rate card
    // from `rate_card`, not `products`.
    mutationFn: ({ id, products, ...rest }: UpdateInsurerInput) =>
      api.put<{ insurer: Insurer }>(`/api/v1/admin/insurers/${id}`, {
        ...rest,
        ...(products ? { rate_card: products } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.insurers() });
    },
  });
}
