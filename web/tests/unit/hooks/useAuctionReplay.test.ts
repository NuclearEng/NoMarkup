import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuctionReplay, type ReplayData } from '@/hooks/useAuctionReplay';

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

const mockReplay: ReplayData = {
  events: [
    {
      id: 'ev-1',
      job_id: 'job-1',
      event_type: 'bid_placed',
      amount_cents: 50000,
      created_at: '2026-04-25T00:00:00Z',
    },
  ],
  job_title: 'Roof repair',
  category: 'roofing',
  starting_bid_cents: 100000,
  winning_bid_cents: 50000,
  total_savings_cents: 50000,
  duration_seconds: 600,
  bid_count: 1,
};

describe('useAuctionReplay', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('fetches replay data via the public endpoint', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce(mockReplay);

    const { result } = renderHook(() => useAuctionReplay('job-1'), {
      wrapper: wrap(client),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.job_title).toBe('Roof repair');
    expect(result.current.data?.events).toHaveLength(1);
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/auctions/job-1/replay');
  });

  it('does not fetch when jobId is empty', () => {
    const { result } = renderHook(() => useAuctionReplay(''), {
      wrapper: wrap(client),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.getPublic)).not.toHaveBeenCalled();
  });

  it('surfaces errors from the API', async () => {
    vi.mocked(api.getPublic).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useAuctionReplay('job-1'), {
      wrapper: wrap(client),
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
