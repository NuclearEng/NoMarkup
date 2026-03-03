import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  usePlaceBid,
  useUpdateBid,
  useWithdrawBid,
  useAcceptOffer,
  useAwardBid,
  useBidsForJob,
  useMyBids,
  useBidCount,
} from '@/hooks/useBids';
import type { Bid, BidsForJobResponse, MyBidsResponse } from '@/types';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
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

const mockBid: Bid = {
  id: 'bid-1',
  job_id: 'job-1',
  provider_id: 'prov-1',
  amount_cents: 5000,
  is_offer_accepted: false,
  status: 'active',
  original_amount_cents: 5000,
  bid_history: [],
  created_at: '2026-03-01T12:00:00Z',
  updated_at: '2026-03-01T12:00:00Z',
  awarded_at: null,
  withdrawn_at: null,
};

describe('usePlaceBid', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('places a bid and invalidates related queries', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ bid: mockBid });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => usePlaceBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      jobId: 'job-1',
      input: { amount_cents: 5000 },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe('bid-1');
    expect(result.current.data?.amount_cents).toBe(5000);
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/jobs/job-1/bids',
      { amount_cents: 5000 },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['jobs', 'job-1'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['bidCount', 'job-1'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['bidsForJob', 'job-1'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['myBids'],
    });
  });

  it('handles bid placement error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new Error('Auction closed'),
    );

    const { result } = renderHook(() => usePlaceBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      jobId: 'job-1',
      input: { amount_cents: 5000 },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateBid', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('updates a bid amount', async () => {
    const updatedBid = { ...mockBid, amount_cents: 4500 };
    vi.mocked(api.patch).mockResolvedValueOnce({ bid: updatedBid });

    const { result } = renderHook(() => useUpdateBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      bidId: 'bid-1',
      input: { new_amount_cents: 4500 },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.amount_cents).toBe(4500);
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      '/api/v1/bids/bid-1',
      { new_amount_cents: 4500 },
    );
  });
});

describe('useWithdrawBid', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('withdraws a bid', async () => {
    const withdrawnBid = { ...mockBid, status: 'withdrawn' as const };
    vi.mocked(api.delete).mockResolvedValueOnce({ bid: withdrawnBid });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useWithdrawBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('bid-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe('withdrawn');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['myBids'] });
  });
});

describe('useAcceptOffer', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('accepts an offer for a job', async () => {
    const offerBid = { ...mockBid, is_offer_accepted: true };
    vi.mocked(api.post).mockResolvedValueOnce({ bid: offerBid });

    const { result } = renderHook(() => useAcceptOffer(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('job-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.is_offer_accepted).toBe(true);
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/jobs/job-1/bids/accept-offer',
    );
  });
});

describe('useAwardBid', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('awards a bid', async () => {
    const awardedBid = {
      ...mockBid,
      status: 'awarded' as const,
      awarded_at: '2026-03-03T12:00:00Z',
    };
    vi.mocked(api.post).mockResolvedValueOnce({ bid: awardedBid });

    const { result } = renderHook(() => useAwardBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ jobId: 'job-1', bidId: 'bid-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe('awarded');
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/jobs/job-1/bids/bid-1/award',
    );
  });
});

describe('useBidsForJob', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches bids for a job', async () => {
    const response: BidsForJobResponse = {
      bids: [
        {
          bid: mockBid,
          provider_display_name: 'Provider 1',
          provider_business_name: 'Plumbing Co',
          provider_avatar_url: null,
          trust_score: null,
          review_summary: null,
          jobs_completed: 10,
        },
      ],
    };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useBidsForJob('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.bids).toHaveLength(1);
    expect(result.current.data?.bids[0]?.provider_display_name).toBe(
      'Provider 1',
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/jobs/job-1/bids',
    );
  });

  it('does not fetch when jobId is empty', () => {
    const { result } = renderHook(() => useBidsForJob(''), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useBidsForJob('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useMyBids', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches user bids with filters', async () => {
    const response: MyBidsResponse = {
      bids: [mockBid],
      pagination: {
        totalCount: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNext: false,
      },
    };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useMyBids('active', 1), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.bids).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/bids/mine?status=active&page=1',
    );
  });

  it('fetches without filters', async () => {
    const response: MyBidsResponse = {
      bids: [],
      pagination: {
        totalCount: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        hasNext: false,
      },
    };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useMyBids(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/bids/mine');
  });
});

describe('useBidCount', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches the bid count for a job', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ count: 5 });

    const { result } = renderHook(() => useBidCount('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(5);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/jobs/job-1/bids/count',
    );
  });

  it('does not fetch when jobId is empty', () => {
    const { result } = renderHook(() => useBidCount(''), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('handles count fetch error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useBidCount('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
