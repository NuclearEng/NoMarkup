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
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
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
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const mockMarketRange: AnalyticsMarketRange = {
  low_cents: 5000,
  median_cents: 12500,
  high_cents: 25000,
  sample_size: 42,
};

const mockProviderAnalytics: ProviderAnalytics = {
  total_jobs_completed: 15,
  total_earnings_cents: 750000,
  average_rating: 4.8,
  total_reviews: 12,
  active_bids: 3,
  win_rate: 0.65,
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

    const { result } = renderHook(
      () => useMarketRange('cat-1'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.low_cents).toBe(5000);
    expect(result.current.data?.median_cents).toBe(12500);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/analytics/market-range?category_id=cat-1'),
    );
  });

  it('passes subcategory and service type params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockMarketRange);

    const { result } = renderHook(
      () => useMarketRange('cat-1', 'subcat-1', 'svc-1'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

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

    await waitFor(() => expect(result.current.isError).toBe(true));
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

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.total_jobs_completed).toBe(15);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/analytics/provider');
  });

  it('passes date range params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockProviderAnalytics);

    const { result } = renderHook(
      () => useProviderAnalytics('2026-01-01', '2026-03-01'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('start_date=2026-01-01'),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('end_date=2026-03-01'),
    );
  });

  it('handles API errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useProviderAnalytics(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
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
      total_cents: 500000,
      periods: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockEarnings);

    const { result } = renderHook(() => useProviderEarnings(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/analytics/provider/earnings',
    );
  });

  it('passes group_by param', async () => {
    const mockEarnings: ProviderEarningsResponse = {
      total_cents: 500000,
      periods: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockEarnings);

    const { result } = renderHook(
      () => useProviderEarnings('2026-01-01', '2026-03-01', 'month'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('group_by=month'),
    );
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
      total_cents: 300000,
      periods: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockSpending);

    const { result } = renderHook(() => useCustomerSpending(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/analytics/customer/spending',
    );
  });

  it('passes date and group_by params', async () => {
    const mockSpending: CustomerSpendingResponse = {
      total_cents: 300000,
      periods: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockSpending);

    const { result } = renderHook(
      () => useCustomerSpending('2026-01-01', '2026-03-01', 'week'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('group_by=week'),
    );
  });

  it('handles API errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useCustomerSpending(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
