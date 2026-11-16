// useWatchlist — branches useWatchlist.test.ts leaves untested: the
// logged-out `enabled: false` guard, the watch toggle's toasts/invalidations
// and non-API failure copy, alias precedence in savedSearchQueryToParams, and
// every price-range / facet shape of summarizeSavedSearchQuery.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  savedSearchQueryToParams,
  summarizeSavedSearchQuery,
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useWatchListing,
  useWatchlist,
} from '@/hooks/useWatchlist';
import type { SavedSearchQuery } from '@/hooks/useWatchlist';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => {
      toastSuccess(...a);
    },
    error: (...a: unknown[]) => {
      toastError(...a);
    },
  },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { api, ApiError } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = createTestQueryClient();
});

afterEach(() => {
  queryClient.clear();
});

describe('useWatchlist enabled guard', () => {
  it('skips the auth-only request for logged-out visitors', () => {
    const { result } = renderHook(() => useWatchlist(undefined, { enabled: false }), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'no options', options: undefined },
    { name: 'options without enabled', options: {} },
    { name: 'enabled: true', options: { enabled: true } },
  ])('fetches page 1 by default with $name', async ({ options }) => {
    const payload = { listings: [], pagination: { page: 1 } };
    vi.mocked(api.get).mockResolvedValueOnce(payload);

    const { result } = renderHook(() => useWatchlist(undefined, options), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/me/watchlist');
    // An omitted page shares the cache entry with an explicit page 1.
    expect(queryClient.getQueryData(['watchlist', 1])).toEqual(payload);
  });
});

describe('useWatchListing', () => {
  it.each([
    { watching: true, verb: 'post' as const, toast: 'Added to watchlist' },
    { watching: false, verb: 'delete' as const, toast: 'Removed from watchlist' },
  ])(
    'watching=$watching uses $verb, toasts and refreshes watchlist + that listing',
    async ({ watching, verb, toast }) => {
      vi.mocked(api[verb]).mockResolvedValueOnce({ watching });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useWatchListing('l-1'), {
        wrapper: createWrapper(queryClient),
      });
      result.current.mutate({ watching });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(vi.mocked(api[verb])).toHaveBeenCalledWith('/api/v1/listings/l-1/watch');
      expect(vi.mocked(api[verb === 'post' ? 'delete' : 'post'])).not.toHaveBeenCalled();
      expect(toastSuccess).toHaveBeenCalledTimes(1);
      expect(toastSuccess).toHaveBeenCalledWith(toast);
      expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
        ['watchlist'],
        ['listings', 'l-1'],
      ]);
    },
  );

  it('shows the fallback and refreshes nothing on a non-API failure', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new TypeError('network down'));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useWatchListing('l-1'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ watching: true });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('Failed to update watchlist');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('saved-search mutations failure copy', () => {
  it('useCreateSavedSearch shows the gateway reason', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: 'you already saved this search' })),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateSavedSearch(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ name: 'Sofas', query: { query: 'sofa' } });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('you already saved this search');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('useDeleteSavedSearch shows its fallback on a non-API failure', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce('nope');

    const { result } = renderHook(() => useDeleteSavedSearch(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('ss-1');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/api/v1/me/saved-searches/ss-1');
    expect(toastError).toHaveBeenCalledWith('Failed to remove saved search');
  });
});

describe('savedSearchQueryToParams alias precedence', () => {
  it('canonical query / category_id win over the q / category aliases', () => {
    expect(
      savedSearchQueryToParams({
        q: 'alias term',
        query: 'canonical term',
        category: 'alias-cat',
        category_id: 'canonical-cat',
      }),
    ).toEqual({ query: 'canonical term', category_id: 'canonical-cat' });
  });

  it('never leaks the alias keys into the params', () => {
    const params = savedSearchQueryToParams({ q: 'drill', category: 'tools', pickup_zip: '98101' });

    expect(params).toEqual({ query: 'drill', category_id: 'tools', pickup_zip: '98101' });
    expect(Object.keys(params)).not.toContain('q');
    expect(Object.keys(params)).not.toContain('category');
  });

  it('a whitespace-only legacy string yields no filters', () => {
    expect(savedSearchQueryToParams('   ')).toEqual({});
  });
});

describe('summarizeSavedSearchQuery', () => {
  interface SummaryCase {
    name: string;
    query: SavedSearchQuery;
    summary: string;
  }

  const CASES: SummaryCase[] = [
    { name: 'min and max → a range', query: { min_price_cents: 1000, max_price_cents: 5050 }, summary: '$10–$51' },
    { name: 'min only → open-ended', query: { min_price_cents: 2500 }, summary: '$25+' },
    { name: 'max only → "under"', query: { max_price_cents: 9900 }, summary: 'under $99' },
    {
      name: 'a $0 minimum is still a bound, not "no minimum"',
      query: { min_price_cents: 0, max_price_cents: 2000 },
      summary: '$0–$20',
    },
    { name: 'a $0 minimum alone', query: { min_price_cents: 0 }, summary: '$0+' },
    { name: 'pickup zip', query: { pickup_zip: '98101' }, summary: 'near 98101' },
    { name: 'ending soon', query: { ending_soon: true }, summary: 'ending soon' },
    { name: 'ending_soon=false adds nothing', query: { ending_soon: false }, summary: 'All auctions' },
    {
      name: 'every facet, in a fixed order',
      query: {
        q: 'drill',
        category: 'tools',
        pickup_zip: '98101',
        min_price_cents: 500,
        ending_soon: true,
      },
      summary: '"drill" · in tools · near 98101 · $5+ · ending soon',
    },
    { name: 'a whitespace-only legacy string', query: '  ', summary: 'All auctions' },
  ];

  it.each(CASES)('$name', ({ query, summary }) => {
    expect(summarizeSavedSearchQuery(query)).toBe(summary);
  });
});
