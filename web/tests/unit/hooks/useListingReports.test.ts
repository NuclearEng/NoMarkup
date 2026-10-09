import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReportListing } from '@/hooks/useListingReports';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

const { api } = await import('@/lib/api');

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useReportListing', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('posts reason + description to the listing report endpoint', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'rep-1', status: 'open' });

    const { result } = renderHook(() => useReportListing(), { wrapper: wrap(client) });
    result.current.mutate({
      listingId: 'listing-uuid',
      reason: 'stolen',
      description: 'Looks like my bike',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/listings/listing-uuid/report', {
      reason: 'stolen',
      description: 'Looks like my bike',
    });
    expect(result.current.data?.status).toBe('open');
  });

  it('sends empty description when omitted', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ status: 'already_reported' });

    const { result } = renderHook(() => useReportListing(), { wrapper: wrap(client) });
    result.current.mutate({ listingId: 'l-2', reason: 'spam' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/listings/l-2/report', {
      reason: 'spam',
      description: '',
    });
  });
});
