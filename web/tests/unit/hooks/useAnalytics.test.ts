import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useMarketRange,
  useProviderAnalytics,
  useProviderEarnings,
  useCustomerSpending,
} from '@/hooks/useAnalytics';
import type {
  AnalyticsMarketRange,
  ProviderAnalytics,
  ProviderEarningsResponse,
  CustomerSpendingResponse,
} from '@/types';

// Mock the api module
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`API error ${String(status)}: ${body}`);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }
  return {
    api: {
      get: vi.fn(),
      getPublic: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    ApiError,
  };
});

// Seed the auth store so `enabled: !!userId` is true and the query fires.
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'user-1' } }),
}));

const { api, ApiError: FakeApiError } = await import('@/lib/api');

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

const mockMarketRange: AnalyticsMarketRange = {
  category_id: 'cat-1',
  subcategory_id: 'subcat-1',
  service_type_id: 'svc-1',
  region: 'us-west',
  low_cents: 5000,
  median_cents: 12500,
  high_cents: 25000,
  data_points: 42,
  source: 'platform',
  confidence: 0.85,
  computed_at: '2026-01-01T00:00:00Z',
};

const mockProviderAnalytics: ProviderAnalytics = {
  total_bids: 23,
  bids_won: 15,
  win_rate: 0.65,
  average_bid_cents: 50000,
  jobs_completed: 15,
  jobs_in_progress: 3,
  on_time_rate: 0.92,
  completion_rate: 0.95,
  total_earnings_cents: 750000,
  average_job_value_cents: 50000,
  average_rating: 4.8,
  total_reviews: 12,
  rating_trend: 0.1,
  avg_response_time_minutes: 30,
  category_breakdown: [],
};

describe('useMarketRange', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches market range for a category', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockMarketRange);

    const { result } = renderHook(() => useMarketRange('cat-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.low_cents).toBe(5000);
    expect(result.current.data?.median_cents).toBe(12500);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/analytics/market/range?category_id=cat-1'),
    );
  });

  it('passes subcategory and service type params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockMarketRange);

    const { result } = renderHook(() => useMarketRange('cat-1', 'subcat-1', 'svc-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('subcategory_id=subcat-1'),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('service_type_id=svc-1'),
    );
  });

  it('does not fetch when categoryId is empty', () => {
    const { result } = renderHook(() => useMarketRange(''), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('handles API errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useMarketRange('cat-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(result.current.error).toBeDefined();
  });
});

describe('useProviderAnalytics', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches provider analytics without dates', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockProviderAnalytics);

    const { result } = renderHook(() => useProviderAnalytics(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.jobs_completed).toBe(15);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/analytics/providers/user-1');
  });

  it('passes date range params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockProviderAnalytics);

    const { result } = renderHook(() => useProviderAnalytics('2026-01-01', '2026-03-01'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('start_date=2026-01-01'),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('end_date=2026-03-01'));
  });

  it('handles API errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useProviderAnalytics(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });

  it('returns null on 404 (graceful degrade)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(404, 'no analytics'));

    const { result } = renderHook(() => useProviderAnalytics(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('returns null on 500', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(500, 'down'));

    const { result } = renderHook(() => useProviderAnalytics(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });
});

describe('useProviderEarnings', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches earnings without params', async () => {
    const mockEarnings: ProviderEarningsResponse = {
      data_points: [],
      total_earnings_cents: 500000,
      total_fees_cents: 25000,
      net_earnings_cents: 475000,
      total_jobs: 10,
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockEarnings);

    const { result } = renderHook(() => useProviderEarnings(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/analytics/providers/user-1/earnings',
    );
  });

  it('passes group_by param', async () => {
    const mockEarnings: ProviderEarningsResponse = {
      data_points: [],
      total_earnings_cents: 500000,
      total_fees_cents: 25000,
      net_earnings_cents: 475000,
      total_jobs: 10,
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockEarnings);

    const { result } = renderHook(() => useProviderEarnings('2026-01-01', '2026-03-01', 'month'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('group_by=month'));
  });

  it('returns null on 404 (graceful degrade — earnings may not exist)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(404, 'no earnings'));

    const { result } = renderHook(() => useProviderEarnings(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('returns null on 500 (service degraded)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(500, 'down'));

    const { result } = renderHook(() => useProviderEarnings(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404/500 ApiError so caller sees real bugs', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(401, 'unauthorized'));

    const { result } = renderHook(() => useProviderEarnings(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });
});

describe('useCustomerSpending', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches spending without params', async () => {
    const mockSpending: CustomerSpendingResponse = {
      data_points: [],
      total_spent_cents: 300000,
      total_jobs: 5,
      average_job_cost_cents: 60000,
      total_savings_cents: 50000,
      category_breakdown: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockSpending);

    const { result } = renderHook(() => useCustomerSpending(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/analytics/customers/me/spending');
  });

  it('passes date and group_by params', async () => {
    const mockSpending: CustomerSpendingResponse = {
      data_points: [],
      total_spent_cents: 300000,
      total_jobs: 5,
      average_job_cost_cents: 60000,
      total_savings_cents: 50000,
      category_breakdown: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockSpending);

    const { result } = renderHook(() => useCustomerSpending('2026-01-01', '2026-03-01', 'week'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(expect.stringContaining('group_by=week'));
  });

  it('handles API errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useCustomerSpending(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });

  it('returns null on 404 (graceful degrade)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(404, 'no spend'));

    const { result } = renderHook(() => useCustomerSpending(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('returns null on 500', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(500, 'down'));

    const { result } = renderHook(() => useCustomerSpending(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });
});
