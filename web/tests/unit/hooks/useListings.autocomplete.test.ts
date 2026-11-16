import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useListingsAutocomplete,
  useSimilarListings,
} from '@/hooks/useListings';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

const { api } = (await import('@/lib/api')) as unknown as {
  api: { getPublic: ReturnType<typeof vi.fn> };
};

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('useListingsAutocomplete', () => {
  beforeEach(() => {
    api.getPublic.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not fire when query is shorter than 2 chars', () => {
    api.getPublic.mockResolvedValue({ suggestions: [] });
    renderHook(() => useListingsAutocomplete('a'), { wrapper: makeWrapper() });
    expect(api.getPublic).not.toHaveBeenCalled();
  });

  it('does not fire when the trimmed query is empty', () => {
    api.getPublic.mockResolvedValue({ suggestions: [] });
    renderHook(() => useListingsAutocomplete('   '), {
      wrapper: makeWrapper(),
    });
    expect(api.getPublic).not.toHaveBeenCalled();
  });

  it('fires once query >= 2 chars and returns the response', async () => {
    api.getPublic.mockResolvedValue({
      suggestions: [
        { type: 'listing', id: 'L1', title: 'Eames lounge', starting_price_cents: 1000 },
      ],
    });
    const { result } = renderHook(() => useListingsAutocomplete('eames'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.getPublic).toHaveBeenCalledTimes(1);
    const url = api.getPublic.mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/v1/listings/autocomplete');
    expect(url).toContain('q=eames');
    expect(url).toContain('limit=10');
    expect(result.current.data?.suggestions).toHaveLength(1);
    expect(result.current.data?.suggestions[0]?.title).toBe('Eames lounge');
  });

  it('URL-encodes the query parameter', async () => {
    api.getPublic.mockResolvedValue({ suggestions: [] });
    renderHook(() => useListingsAutocomplete('mid century / modern'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalled();
    });
    const url = api.getPublic.mock.calls[0]?.[0] as string;
    expect(url).toContain('mid%20century');
  });
});

describe('useSimilarListings', () => {
  beforeEach(() => {
    api.getPublic.mockReset();
  });

  it('does not fire when listingId is empty', () => {
    api.getPublic.mockResolvedValue({ listings: [] });
    renderHook(() => useSimilarListings(''), { wrapper: makeWrapper() });
    expect(api.getPublic).not.toHaveBeenCalled();
  });

  it('hits the similar endpoint with limit=12 by default', async () => {
    api.getPublic.mockResolvedValue({ listings: [] });
    renderHook(() => useSimilarListings('listing-abc'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(api.getPublic).toHaveBeenCalled();
    });
    const url = api.getPublic.mock.calls[0]?.[0] as string;
    expect(url).toBe('/api/v1/listings/listing-abc/similar?limit=12');
  });

  it('returns the response data on success', async () => {
    api.getPublic.mockResolvedValue({
      listings: [{ id: 'a' }, { id: 'b' }],
    });
    const { result } = renderHook(() => useSimilarListings('listing-x'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.listings).toHaveLength(2);
  });
});
