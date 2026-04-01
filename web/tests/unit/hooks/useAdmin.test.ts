import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAdminUsers,
  useAdminUser,
  useSuspendUser,
  useBanUser,
  useAdminDisputes,
  useAdminDispute,
  useResolveDispute,
  useAdminFlaggedReviews,
  usePlatformMetrics,
  useGrowthMetrics,
  useCategoryMetrics,
  useRevenueReport,
} from '@/hooks/useAdmin';
import type {
  AdminUsersResponse,
  AdminUser,
  AdminDisputesResponse,
  Dispute,
  PlatformMetrics,
  GrowthMetrics,
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

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.users).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/users');
  });

  it('passes search params to API', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockUsersResponse);

    const { result } = renderHook(
      () => useAdminUsers({ query: 'test', status: 'active', page: 2 }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('query=test'));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('status=active'));
  });

  it('handles API errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Forbidden'));

    const { result } = renderHook(() => useAdminUsers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
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

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

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
    vi.mocked(api.post).mockResolvedValueOnce({ user: { ...mockAdminUser, status: 'suspended' } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSuspendUser(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ userId: 'user-1', reason: 'Policy violation' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/users/user-1/suspend', {
      reason: 'Policy violation',
    });
    expect(invalidateSpy).toHaveBeenCalled();
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

  it('bans a user', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ user: { ...mockAdminUser, status: 'banned' } });

    const { result } = renderHook(() => useBanUser(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ userId: 'user-1', reason: 'Fraud' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/users/user-1/ban', {
      reason: 'Fraud',
    });
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
      pagination: {
        totalCount: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        hasNext: false,
      },
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockDisputes);

    const { result } = renderHook(() => useAdminDisputes(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/disputes');
  });

  it('passes status filter', async () => {
    const mockDisputes: AdminDisputesResponse = {
      disputes: [],
      pagination: {
        totalCount: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        hasNext: false,
      },
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockDisputes);

    const { result } = renderHook(() => useAdminDisputes({ status: 'open', page: 1 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('status=open'));
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

  it('fetches platform metrics', async () => {
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

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/platform/metrics');
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

    const { result } = renderHook(() => useRevenueReport('2026-01-01', '2026-03-01', 'month'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('start_date=2026-01-01'),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('group_by=month'));
  });
});
