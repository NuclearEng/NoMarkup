import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  usePricingByCategory,
  usePricingHeatmap,
  usePricingOverview,
  type PricingData,
  type PricingOverviewCategory,
} from '@/hooks/usePricing';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) {
      return this.message || fallback;
    }
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

const overviewCategory: PricingOverviewCategory = {
  category_name: 'Plumbing',
  category_slug: 'plumbing',
  total_jobs: 42,
  avg_median_cents: 25_000,
  avg_savings_cents: 4_000,
};

const pricingRow: PricingData = {
  category_name: 'Plumbing',
  category_slug: 'plumbing',
  zip_code: '94110',
  completed_jobs: 12,
  avg_price_cents: 24_500,
  p25_price_cents: 18_000,
  median_price_cents: 24_000,
  p75_price_cents: 30_000,
  min_price_cents: 12_000,
  max_price_cents: 48_000,
  avg_savings_cents: 5_000,
  refreshed_at: '2026-04-25T00:00:00Z',
};

describe('usePricingOverview', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches the overview from the public pricing endpoint', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ categories: [overviewCategory] });

    const { result } = renderHook(() => usePricingOverview(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.categories).toHaveLength(1);
    expect(result.current.data?.categories[0]?.category_slug).toBe('plumbing');
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/pricing');
  });
});

describe('usePricingByCategory', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches the category pricing without zip when omitted', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ prices: [pricingRow] });

    const { result } = renderHook(() => usePricingByCategory('plumbing'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.prices).toHaveLength(1);
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/pricing/plumbing');
  });

  it('appends and URL-encodes the zip query param when provided', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ prices: [] });

    const { result } = renderHook(
      () => usePricingByCategory('plumbing', '94110'),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith(
      '/api/v1/pricing/plumbing?zip=94110',
    );
  });

  it('encodes special characters in the zip param', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ prices: [] });

    const { result } = renderHook(
      () => usePricingByCategory('plumbing', 'A B'),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith(
      '/api/v1/pricing/plumbing?zip=A%20B',
    );
  });

  it('does not fetch when slug is empty', () => {
    const { result } = renderHook(() => usePricingByCategory(''), {
      wrapper: createWrapper(queryClient),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.getPublic)).not.toHaveBeenCalled();
  });
});

describe('usePricingHeatmap', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches the public heatmap with no category', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ points: [] });

    const { result } = renderHook(() => usePricingHeatmap(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.points).toEqual([]);
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/pricing/heatmap');
  });

  it('appends an encoded category query when provided', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ points: [] });

    const { result } = renderHook(() => usePricingHeatmap('lawn care'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith(
      '/api/v1/pricing/heatmap?category=lawn%20care',
    );
  });
});
