import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAdminUsers,
  useAdminUser,
  useSuspendUser,
  useBanUser,
  useVerificationQueue,
  useReviewDocument,
  useAdminJobs,
  useSuspendJob,
  useRemoveJob,
  useAdminDisputes,
  useAdminDispute,
  useResolveDispute,
  useAdminFlaggedReviews,
  useResolveReviewFlag,
  useRemoveReview,
  useAdminPayments,
  useAdminPaymentDetails,
  usePlatformMetrics,
  useRevenueReport,
  useUpdateFeeConfig,
  useGrowthMetrics,
  useCategoryMetrics,
  usePlatformBanking,
  useSetPlatformBankAccount,
  useDeletePlatformBankAccount,
} from '@/hooks/useAdmin';
import type {
  AdminUsersResponse,
  AdminUser,
  AdminDisputesResponse,
  AdminFlaggedReviewsResponse,
  AdminJobsResponse,
  AdminPaymentsResponse,
  CategoryMetricsResponse,
  FeeConfig,
  GrowthMetrics,
  PlatformBankingResponse,
  PlatformMetrics,
  RevenueReport,
} from '@/types';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  // Banking mutations send a fresh Idempotency-Key; stub it deterministically.
  idempotencyHeader: () => ({ 'Idempotency-Key': 'test-key' }),
}));

// Banking hooks fire toasts; stub sonner so they're no-ops in tests.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { api } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const mockAdminUser: AdminUser = {
  id: 'user-1',
  email: 'admin@example.com',
  display_name: 'Admin User',
  phone: '',
  roles: ['admin'],
  status: 'active',
  avatar_url: '',
  created_at: '2026-01-01T00:00:00Z',
};

const mockUsersResponse: AdminUsersResponse = {
  users: [mockAdminUser],
  pagination: {
    totalCount: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    hasNext: false,
  },
};

const emptyPagination = {
  totalCount: 0,
  page: 1,
  pageSize: 20,
  totalPages: 0,
  hasNext: false,
};

describe('useAdminUsers', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches admin users list', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockUsersResponse);

    const { result } = renderHook(() => useAdminUsers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.users).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/users');
  });

  it('passes search params to API', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockUsersResponse);

    const { result } = renderHook(
      () => useAdminUsers({ query: 'test', status: 'active', page: 2 }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('query=test'));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('status=active'));
  });

  it('passes role and page_size params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockUsersResponse);

    const { result } = renderHook(
      () => useAdminUsers({ role: 'provider', page_size: 50 }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('role=provider'));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('page_size=50'));
  });

  it('handles API errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Forbidden'));

    const { result } = renderHook(() => useAdminUsers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('useAdminUser', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches a single admin user', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ user: mockAdminUser });

    const { result } = renderHook(() => useAdminUser('user-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.user.id).toBe('user-1');
  });

  it('does not fetch when userId is empty', () => {
    const { result } = renderHook(() => useAdminUser(''), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});

describe('useSuspendUser', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('suspends a user and invalidates queries', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      user: { ...mockAdminUser, status: 'suspended' },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSuspendUser(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ userId: 'user-1', reason: 'Policy violation' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/users/user-1/suspend', {
      reason: 'Policy violation',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin'] });
  });

  it('handles suspend failure', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useSuspendUser(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ userId: 'user-1', reason: 'x' });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('useBanUser', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('bans a user and invalidates the admin scope', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      user: { ...mockAdminUser, status: 'banned' },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useBanUser(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ userId: 'user-1', reason: 'Fraud' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/users/user-1/ban', {
      reason: 'Fraud',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin'] });
  });
});

describe('useVerificationQueue', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches with no params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      documents: [],
      pagination: emptyPagination,
    });

    const { result } = renderHook(() => useVerificationQueue(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/verification/queue');
  });

  it('fetches with paging params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      documents: [],
      pagination: emptyPagination,
    });

    const { result } = renderHook(() => useVerificationQueue(2, 25), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringMatching(/page=2/),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringMatching(/page_size=25/),
    );
  });
});

describe('useReviewDocument', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('approves a document and invalidates verification queue', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ status: 'approved' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useReviewDocument(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ documentId: 'doc-1', approved: true });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/admin/verification/doc-1/review',
      { approved: true, rejection_reason: undefined },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['admin', 'verification'],
    });
  });

  it('rejects a document with a reason', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ status: 'rejected' });

    const { result } = renderHook(() => useReviewDocument(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      documentId: 'doc-2',
      approved: false,
      rejection_reason: 'blurry image',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/admin/verification/doc-2/review',
      { approved: false, rejection_reason: 'blurry image' },
    );
  });
});

describe('useAdminJobs', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches admin jobs with no filters', async () => {
    const empty: AdminJobsResponse = { jobs: [], pagination: emptyPagination };
    vi.mocked(api.get).mockResolvedValueOnce(empty);

    const { result } = renderHook(() => useAdminJobs(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/jobs');
  });

  it('encodes status, customer_id, category_id', async () => {
    const empty: AdminJobsResponse = { jobs: [], pagination: emptyPagination };
    vi.mocked(api.get).mockResolvedValueOnce(empty);

    const { result } = renderHook(
      () =>
        useAdminJobs({
          status: 'open',
          customer_id: 'cust-1',
          category_id: 'cat-1',
          page: 3,
          page_size: 10,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = vi.mocked(api.get).mock.calls[0]?.[0] as string;
    expect(url).toContain('status=open');
    expect(url).toContain('customer_id=cust-1');
    expect(url).toContain('category_id=cat-1');
    expect(url).toContain('page=3');
    expect(url).toContain('page_size=10');
  });
});

describe('useSuspendJob', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('suspends a job and invalidates job-scoped queries', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSuspendJob(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ jobId: 'job-1', reason: 'spam' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/jobs/job-1/suspend', {
      reason: 'spam',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'jobs'] });
  });
});

describe('useRemoveJob', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('removes a job and invalidates job-scoped queries', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRemoveJob(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ jobId: 'job-2', reason: 'illegal' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/jobs/job-2/remove', {
      reason: 'illegal',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'jobs'] });
  });
});

describe('useAdminDisputes', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches disputes list', async () => {
    const mockDisputes: AdminDisputesResponse = {
      disputes: [],
      pagination: emptyPagination,
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockDisputes);

    const { result } = renderHook(() => useAdminDisputes(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/disputes');
  });

  it('passes status filter', async () => {
    const mockDisputes: AdminDisputesResponse = {
      disputes: [],
      pagination: emptyPagination,
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockDisputes);

    const { result } = renderHook(
      () => useAdminDisputes({ status: 'open', page: 1, page_size: 5 }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = vi.mocked(api.get).mock.calls[0]?.[0] as string;
    expect(url).toContain('status=open');
    expect(url).toContain('page=1');
    expect(url).toContain('page_size=5');
  });
});

describe('useAdminDispute', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('does not fetch when disputeId is empty', () => {
    const { result } = renderHook(() => useAdminDispute(''), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches when disputeId is present', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ dispute: { id: 'd-1' } });

    const { result } = renderHook(() => useAdminDispute('d-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/disputes/d-1');
  });
});

describe('useResolveDispute', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('maps guarantee_claim true to "approved"', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useResolveDispute(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      disputeId: 'd-1',
      resolution_type: 'refund',
      resolution_notes: 'cust right',
      refund_amount_cents: 5000,
      guarantee_claim: true,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/disputes/d-1/resolve', {
      resolution_type: 'refund',
      resolution_notes: 'cust right',
      refund_amount_cents: 5000,
      guarantee_outcome: 'approved',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['admin', 'disputes'],
    });
  });

  it('maps undefined guarantee_claim to empty string', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});

    const { result } = renderHook(() => useResolveDispute(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      disputeId: 'd-2',
      resolution_type: 'reject',
      resolution_notes: 'no merit',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/disputes/d-2/resolve', {
      resolution_type: 'reject',
      resolution_notes: 'no merit',
      refund_amount_cents: undefined,
      guarantee_outcome: '',
    });
  });
});

describe('useAdminFlaggedReviews', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches flagged reviews with status', async () => {
    const empty: AdminFlaggedReviewsResponse = {
      flags: [],
      pagination: emptyPagination,
    };
    vi.mocked(api.get).mockResolvedValueOnce(empty);

    const { result } = renderHook(
      () => useAdminFlaggedReviews({ status: 'pending', page: 1, page_size: 10 }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = vi.mocked(api.get).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/v1/admin/reviews/flagged');
    expect(url).toContain('status=pending');
  });

  it('fetches without filters', async () => {
    const empty: AdminFlaggedReviewsResponse = {
      flags: [],
      pagination: emptyPagination,
    };
    vi.mocked(api.get).mockResolvedValueOnce(empty);

    const { result } = renderHook(() => useAdminFlaggedReviews(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/reviews/flagged');
  });
});

describe('useResolveReviewFlag', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('resolves a flag and invalidates reviews scope', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useResolveReviewFlag(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ flagId: 'f-1', action: 'dismiss', notes: 'looks fine' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/admin/reviews/flags/f-1/resolve',
      { action: 'dismiss', notes: 'looks fine' },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['admin', 'reviews'],
    });
  });
});

describe('useRemoveReview', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('removes a review with a reason and invalidates reviews scope', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({});
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRemoveReview(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ reviewId: 'r-1', reason: 'abusive' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/api/v1/admin/reviews/r-1', {
      reason: 'abusive',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['admin', 'reviews'],
    });
  });

  it('handles delete failure', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useRemoveReview(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ reviewId: 'r-1', reason: 'x' });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('useAdminPayments', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches payments with no params', async () => {
    const empty: AdminPaymentsResponse = {
      payments: [],
      pagination: emptyPagination,
    };
    vi.mocked(api.get).mockResolvedValueOnce(empty);

    const { result } = renderHook(() => useAdminPayments(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/payments');
  });

  it('encodes user_id, status, and date range', async () => {
    const empty: AdminPaymentsResponse = {
      payments: [],
      pagination: emptyPagination,
    };
    vi.mocked(api.get).mockResolvedValueOnce(empty);

    const { result } = renderHook(
      () =>
        useAdminPayments({
          user_id: 'u-1',
          status: 'succeeded',
          start_date: '2026-01-01',
          end_date: '2026-04-01',
          page: 2,
          page_size: 50,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = vi.mocked(api.get).mock.calls[0]?.[0] as string;
    expect(url).toContain('user_id=u-1');
    expect(url).toContain('status=succeeded');
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-04-01');
    expect(url).toContain('page=2');
    expect(url).toContain('page_size=50');
  });
});

describe('useAdminPaymentDetails', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('does not fetch when paymentId is empty', () => {
    const { result } = renderHook(() => useAdminPaymentDetails(''), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('fetches a single payment when id is present', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ payment: { id: 'pay-1' } });

    const { result } = renderHook(() => useAdminPaymentDetails('pay-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/payments/pay-1');
  });
});

describe('usePlatformMetrics', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches platform metrics with no filters', async () => {
    const mockMetrics: PlatformMetrics = {
      total_gmv_cents: 10000000,
      total_revenue_cents: 5000000,
      total_guarantee_fund_cents: 500000,
      effective_take_rate: 0.05,
      total_users: 1000,
      active_users: 800,
      new_users: 50,
      total_jobs_posted: 500,
      total_jobs_completed: 300,
      job_fill_rate: 0.6,
      job_completion_rate: 0.9,
      total_bids: 2000,
      avg_bids_per_job: 4,
      disputes_opened: 10,
      disputes_resolved: 8,
      dispute_rate: 0.02,
      guarantee_claims: 3,
      guarantee_payouts_cents: 150000,
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockMetrics);

    const { result } = renderHook(() => usePlatformMetrics(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/platform/metrics');
  });

  it('fetches with date range', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({} as PlatformMetrics);

    const { result } = renderHook(
      () => usePlatformMetrics('2026-01-01', '2026-03-01'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = vi.mocked(api.get).mock.calls[0]?.[0] as string;
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-03-01');
  });
});

describe('useRevenueReport', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches revenue report with date range', async () => {
    const mockRevenue: RevenueReport = {
      data_points: [],
      total_gmv_cents: 10000000,
      total_revenue_cents: 5000000,
      total_guarantee_fund_cents: 500000,
      effective_take_rate: 0.05,
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockRevenue);

    const { result } = renderHook(
      () => useRevenueReport('2026-01-01', '2026-03-01', 'month'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('start_date=2026-01-01'),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('group_by=month'));
  });

  it('fetches with no filters', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({} as RevenueReport);

    const { result } = renderHook(() => useRevenueReport(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/revenue');
  });
});

describe('useUpdateFeeConfig', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('PUTs the fee config and invalidates the admin scope', async () => {
    const config: FeeConfig = {
      category_id: 'cat-1',
      fee_percentage: 10,
      guarantee_percentage: 2,
      min_fee_cents: 100,
      max_fee_cents: 5000,
      lead_gen_enabled: true,
      lead_gen_percentage: 10,
      lead_gen_min_fee_cents: 500,
      lead_gen_max_fee_cents: 5000,
    };
    vi.mocked(api.put).mockResolvedValueOnce(config);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateFeeConfig(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate(config);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/api/v1/admin/fees', config);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin'] });
  });
});

describe('useGrowthMetrics', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches with all params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({} as GrowthMetrics);

    const { result } = renderHook(
      () => useGrowthMetrics('2026-01-01', '2026-03-01', 'week'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = vi.mocked(api.get).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/v1/admin/platform/growth');
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-03-01');
    expect(url).toContain('group_by=week');
  });

  it('fetches with no params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({} as GrowthMetrics);

    const { result } = renderHook(() => useGrowthMetrics(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/platform/growth');
  });
});

describe('useCategoryMetrics', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches category metrics', async () => {
    const empty: CategoryMetricsResponse = { categories: [] };
    vi.mocked(api.get).mockResolvedValueOnce(empty);

    const { result } = renderHook(
      () => useCategoryMetrics('2026-01-01', '2026-04-01'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = vi.mocked(api.get).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/v1/admin/platform/categories');
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-04-01');
  });

  it('fetches with no filters', async () => {
    const empty: CategoryMetricsResponse = { categories: [] };
    vi.mocked(api.get).mockResolvedValueOnce(empty);

    const { result } = renderHook(() => useCategoryMetrics(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/platform/categories');
  });
});

describe('usePlatformBanking', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches the platform bank account', async () => {
    const response: PlatformBankingResponse = {
      account: {
        id: 'ba-1',
        bank_name: 'Test Bank',
        account_holder_name: 'NoMarkup Inc.',
        account_holder_type: 'company',
        last4: '6789',
        routing_last4: '0000',
        currency: 'usd',
        country: 'US',
        status: 'new',
        is_default: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => usePlatformBanking(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.account?.last4).toBe('6789');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/banking');
  });

  it('returns null when no account is set', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ account: null });

    const { result } = renderHook(() => usePlatformBanking(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.account).toBeNull();
  });
});

describe('useSetPlatformBankAccount', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('posts the token with an idempotency key and invalidates banking', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ account: { id: 'ba-1' } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSetPlatformBankAccount(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      bank_account_token: 'btok_test',
      account_holder_name: 'NoMarkup Inc.',
      account_holder_type: 'company',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/admin/banking',
      {
        bank_account_token: 'btok_test',
        account_holder_name: 'NoMarkup Inc.',
        account_holder_type: 'company',
      },
      { 'Idempotency-Key': 'test-key' },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'banking'] });
  });

  it('does not send raw account/routing numbers', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ account: { id: 'ba-1' } });

    const { result } = renderHook(() => useSetPlatformBankAccount(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      bank_account_token: 'btok_test',
      account_holder_name: 'NoMarkup Inc.',
      account_holder_type: 'company',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const body = vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('account_number');
    expect(body).not.toHaveProperty('routing_number');
  });
});

describe('useDeletePlatformBankAccount', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('deletes the account and invalidates banking', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ deleted: true });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeletePlatformBankAccount(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('ba-1');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/api/v1/admin/banking/ba-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'banking'] });
  });
});
