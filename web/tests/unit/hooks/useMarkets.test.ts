// useMarkets — public market catalog. Pins the URL for each filter
// combination (falsy filters are dropped from the query string), the query key
// defaults ('all' / false), the `.markets` unwrap, the public (unauthenticated,
// edge-cacheable) transport, and that the catalog is treated as immutable for
// the session.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMarkets } from '@/hooks/useMarkets';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
  },
}));

const { api } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const markets = [
  { id: 'm-1', name: 'Seattle', country: 'US', is_active: true },
  { id: 'm-2', name: 'Tijuana', country: 'MX', is_active: false },
];

interface MarketsCase {
  name: string;
  options: Parameters<typeof useMarkets>[0];
  url: string;
  key: readonly unknown[];
}

const CASES: MarketsCase[] = [
  {
    name: 'no options → full catalog',
    options: undefined,
    url: '/api/v1/markets',
    key: ['markets', 'all', false],
  },
  {
    name: 'empty options → full catalog',
    options: {},
    url: '/api/v1/markets',
    key: ['markets', 'all', false],
  },
  {
    name: 'country only',
    options: { country: 'MX' },
    url: '/api/v1/markets?country=MX',
    key: ['markets', 'MX', false],
  },
  {
    name: 'activeOnly only',
    options: { activeOnly: true },
    url: '/api/v1/markets?active=true',
    key: ['markets', 'all', true],
  },
  {
    name: 'country + activeOnly',
    options: { country: 'US', activeOnly: true },
    url: '/api/v1/markets?country=US&active=true',
    key: ['markets', 'US', true],
  },
  {
    name: 'activeOnly=false is not sent as a filter',
    options: { country: 'US', activeOnly: false },
    url: '/api/v1/markets?country=US',
    key: ['markets', 'US', false],
  },
];

describe('useMarkets', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it.each(CASES)('$name', async ({ options, url, key }) => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({ markets });

    const { result } = renderHook(() => useMarkets(options), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.getPublic)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith(url);
    // The catalog is public: it must never go through the authenticated client.
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
    // The `{ markets }` envelope is unwrapped to the bare array.
    expect(result.current.data).toEqual(markets);
    expect(queryClient.getQueryData(key)).toEqual(markets);
  });

  it('shares one request between two consumers of the same filter and never goes stale', async () => {
    vi.mocked(api.getPublic).mockResolvedValue({ markets });

    const first = renderHook(() => useMarkets({ country: 'US' }), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(first.result.current.isSuccess).toBe(true);
    });

    // A later mount would refetch on a stale query; staleTime: Infinity means
    // the catalog is fetched once per session.
    const second = renderHook(() => useMarkets({ country: 'US' }), {
      wrapper: createWrapper(queryClient),
    });

    expect(second.result.current.data).toEqual(markets);
    expect(second.result.current.isStale).toBe(false);
    expect(second.result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledTimes(1);
  });

  it('a different filter is a different cache entry and its own request', async () => {
    vi.mocked(api.getPublic)
      .mockResolvedValueOnce({ markets: [markets[0]] })
      .mockResolvedValueOnce({ markets: [markets[1]] });

    const us = renderHook(() => useMarkets({ country: 'US' }), {
      wrapper: createWrapper(queryClient),
    });
    const mx = renderHook(() => useMarkets({ country: 'MX' }), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(us.result.current.isSuccess).toBe(true);
      expect(mx.result.current.isSuccess).toBe(true);
    });

    expect(us.result.current.data).toEqual([markets[0]]);
    expect(mx.result.current.data).toEqual([markets[1]]);
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed catalog fetch as an error with no cached data', async () => {
    const failure = new Error('edge 502');
    vi.mocked(api.getPublic).mockRejectedValueOnce(failure);

    const { result } = renderHook(() => useMarkets(), { wrapper: createWrapper(queryClient) });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
    expect(queryClient.getQueryData(['markets', 'all', false])).toBeUndefined();
  });
});
