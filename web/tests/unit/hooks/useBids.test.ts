import { act, renderHook, waitFor } from '@testing-library/react';
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
  useLiveAuctionState,
  useAuctionEvents,
  useSavings,
  useProviderStreaks,
  useBidStream,
  useOrderBook,
} from '@/hooks/useBids';
import {
  USER_ROLE,
  type Bid,
  type BidsForJobResponse,
  type LiveAuctionState,
  type MyBidsResponse,
  type ProviderStreak,
  type UserSavings,
} from '@/types';

// ApiError mock — the toast.error path calls `err.userMessage(fallback)`,
// so the mock implementation must mirror the real ApiError's surface.
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => {
      toastSuccess(...args);
    },
    error: (...args: unknown[]) => {
      toastError(...args);
    },
  },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  // Real ApiError export so `err instanceof ApiError` checks in production
  // hooks (e.g. explainBidFailure) don't blow up with
  // "No 'ApiError' export is defined" when an error path is exercised.
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

// auction-websocket: mocked so the auction-store import chain doesn't open
// real connections.
vi.mock('@/lib/auction-websocket', () => ({
  auctionWsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onStatusChange: vi.fn(),
    getStatus: vi.fn(() => 'disconnected'),
  },
}));

// Auth store double. `useAuthStore` is used two ways in this import chain:
//  - as a hook with a selector (`useMyBids` reads `state.user` to gate the
//    provider-only /bids/mine query), and
//  - as a namespace object (`useAuthStore.getState()`) for imperative reads.
// The double has to satisfy both, and the state is mutable so a test can drop
// the provider role. `authState` is only dereferenced inside closures, so the
// hoisted `vi.mock` factory never touches it before initialization.
const authState: {
  user: { id: string; roles: string[] } | null;
  accessToken: string | null;
} = {
  user: { id: 'user-1', roles: [USER_ROLE.PROVIDER] },
  accessToken: 'mock-token',
};

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    <T,>(selector: (state: typeof authState) => T): T => selector(authState),
    { getState: () => authState },
  ),
}));

const { api, ApiError } = (await import('@/lib/api')) as unknown as {
  api: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  ApiError: new (status: number, body: string) => Error & {
    userMessage: (fallback: string) => string;
  };
};
const { useAuctionStore } = await import('@/stores/auction-store');

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

function resetAuctionStore() {
  useAuctionStore.setState({
    activeJobId: null,
    connectionStatus: 'disconnected',
    events: [],
    currentLowest: 0,
    bidCount: 0,
    auctionEndsAt: null,
    snipeExtensionCount: 0,
    orderBook: [],
    priceHistory: [],
    bidTimestamps: [],
    flashTimers: {},
  });
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
    vi.mocked(api.post).mockResolvedValueOnce(mockBid);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => usePlaceBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      jobId: 'job-1',
      input: { amount_cents: 5000 },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.id).toBe('bid-1');
    expect(result.current.data?.amount_cents).toBe(5000);
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/jobs/job-1/bids', {
      amount_cents: 5000,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jobs', 'job-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bidCount', 'job-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bidsForJob', 'job-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['myBids'] });
    expect(toastSuccess).toHaveBeenCalledWith('Bid placed successfully');
  });

  it('handles bid placement error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Auction closed'));

    const { result } = renderHook(() => usePlaceBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ jobId: 'job-1', input: { amount_cents: 5000 } });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Failed to place bid');
  });

  it('uses ApiError userMessage for friendly error toasts', async () => {
    const apiErr = new ApiError(409, JSON.stringify({ error: 'duplicate bid' }));
    vi.mocked(api.post).mockRejectedValueOnce(apiErr);

    const { result } = renderHook(() => usePlaceBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ jobId: 'job-1', input: { amount_cents: 5000 } });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalled();
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

  it('updates a bid amount and invalidates broad caches', async () => {
    const updatedBid = { ...mockBid, amount_cents: 4500 };
    vi.mocked(api.patch).mockResolvedValueOnce(updatedBid);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      bidId: 'bid-1',
      input: { new_amount_cents: 4500 },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.amount_cents).toBe(4500);
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/api/v1/bids/bid-1', {
      new_amount_cents: 4500,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bidCount'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bidsForJob'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['myBids'] });
    expect(toastSuccess).toHaveBeenCalledWith('Bid updated');
  });

  it('handles update error path', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useUpdateBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ bidId: 'bid-1', input: { new_amount_cents: 1 } });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Failed to update bid');
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

  it('withdraws a bid and invalidates all bid-related queries', async () => {
    const withdrawnBid = { ...mockBid, status: 'withdrawn' as const };
    vi.mocked(api.delete).mockResolvedValueOnce(withdrawnBid);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useWithdrawBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('bid-1');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.status).toBe('withdrawn');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bidCount'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bidsForJob'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['myBids'] });
    expect(toastSuccess).toHaveBeenCalledWith('Bid withdrawn');
  });

  it('handles withdraw error path', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useWithdrawBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('bid-1');

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Failed to withdraw bid');
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
    vi.mocked(api.post).mockResolvedValueOnce(offerBid);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAcceptOffer(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('job-1');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.is_offer_accepted).toBe(true);
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/jobs/job-1/bids/accept-offer',
      undefined,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jobs', 'job-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bidCount', 'job-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bidsForJob', 'job-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['myBids'] });
    expect(toastSuccess).toHaveBeenCalledWith('Offer accepted');
  });

  it('handles accept offer error path', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useAcceptOffer(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('job-1');

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Failed to accept offer');
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
    vi.mocked(api.post).mockResolvedValueOnce(awardedBid);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAwardBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ jobId: 'job-1', bidId: 'bid-1' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.status).toBe('awarded');
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/jobs/job-1/bids/bid-1/award',
      undefined,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jobs', 'job-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bidsForJob', 'job-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['myBids'] });
    expect(toastSuccess).toHaveBeenCalledWith('Bid awarded — contract created');
  });

  it('handles award error path', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useAwardBid(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ jobId: 'job-1', bidId: 'bid-1' });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(toastError).toHaveBeenCalledWith('Failed to award bid');
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

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.bids).toHaveLength(1);
    expect(result.current.data?.bids[0]?.provider_display_name).toBe('Provider 1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/jobs/job-1/bids');
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

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('useMyBids', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 'user-1', roles: [USER_ROLE.PROVIDER] };
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    authState.user = { id: 'user-1', roles: [USER_ROLE.PROVIDER] };
  });

  it('does not fetch for a non-provider (the /bids/mine query is role-gated)', () => {
    authState.user = { id: 'user-1', roles: [USER_ROLE.CUSTOMER] };

    const { result } = renderHook(() => useMyBids(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('does not fetch when there is no signed-in user', () => {
    authState.user = null;

    const { result } = renderHook(() => useMyBids(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
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

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.bids).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/bids/mine?status=active&page=1');
  });

  it('passes only status when page omitted', async () => {
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

    const { result } = renderHook(() => useMyBids('won'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/bids/mine?status=won');
  });

  it('passes only page when status omitted', async () => {
    const response: MyBidsResponse = {
      bids: [],
      pagination: {
        totalCount: 0,
        page: 2,
        pageSize: 20,
        totalPages: 1,
        hasNext: false,
      },
    };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useMyBids(undefined, 2), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/bids/mine?page=2');
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

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

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

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBe(5);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/jobs/job-1/bids/count');
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

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('useLiveAuctionState', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('does not fetch when jobId is undefined', () => {
    const { result } = renderHook(() => useLiveAuctionState(undefined), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('fetches auction state when jobId is present', async () => {
    const state: LiveAuctionState = {
      job_id: 'job-1',
      lowest_bid_cents: 5000,
      bid_count: 3,
      auction_ends_at: '2099-01-01T00:00:00Z',
      snipe_extension_count: 0,
      max_snipe_extensions: 3,
      recent_events: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(state);

    const { result } = renderHook(() => useLiveAuctionState('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.lowest_bid_cents).toBe(5000);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/jobs/job-1/auction/state');
  });

  it('fetches with default polling when auctionEndsAt is far in the future', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      job_id: 'job-1',
      lowest_bid_cents: 5000,
      bid_count: 0,
      auction_ends_at: null,
      snipe_extension_count: 0,
      max_snipe_extensions: 3,
      recent_events: [],
    });

    // 1 hour out — exercises the default 5000ms branch (not the <5min fast-poll)
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { result } = renderHook(() => useLiveAuctionState('job-1', farFuture), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });
});

describe('useAuctionEvents', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('does not fetch when jobId is undefined', () => {
    const { result } = renderHook(() => useAuctionEvents(undefined), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('fetches auction events for a job', async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      {
        job_id: 'job-1',
        amount_cents: 4500,
        event_type: 'bid_placed',
        created_at: '2026-04-01T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() => useAuctionEvents('job-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/jobs/job-1/auction/events');
  });
});

describe('useSavings', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches user savings list', async () => {
    const savings: UserSavings[] = [
      {
        id: 's-1',
        user_id: 'u-1',
        job_id: 'j-1',
        awarded_cents: 4000,
        market_median_cents: 6000,
        savings_cents: 2000,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];
    vi.mocked(api.get).mockResolvedValueOnce(savings);

    const { result } = renderHook(() => useSavings(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/users/me/savings');
  });
});

describe('useProviderStreaks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches streaks list', async () => {
    const streaks: ProviderStreak[] = [
      {
        id: 'st-1',
        provider_id: 'p-1',
        category_id: null,
        current_streak: 3,
        longest_streak: 5,
        total_wins: 12,
        category_rank: 4,
        updated_at: '2026-04-01T00:00:00Z',
      },
    ];
    vi.mocked(api.get).mockResolvedValueOnce(streaks);

    const { result } = renderHook(() => useProviderStreaks(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.[0]?.current_streak).toBe(3);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/streaks');
  });
});

describe('useBidStream', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
    resetAuctionStore();
  });

  afterEach(() => {
    queryClient.clear();
    resetAuctionStore();
  });

  it('returns derived defaults from an empty store', () => {
    const { result } = renderHook(() => useBidStream(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.events).toEqual([]);
    expect(result.current.bidCount).toBe(0);
    expect(result.current.currentLowest).toBe(0);
    expect(result.current.connectionStatus).toBe('disconnected');
    expect(result.current.isConnected).toBe(false);
    expect(result.current.velocity).toBe(0);
    expect(result.current.momentum).toBe('stable');
    expect(result.current.velocityBuckets).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.current.orderBook).toEqual([]);
    expect(result.current.priceHistory).toEqual([]);
  });

  it('marks isConnected true when status is connected', () => {
    act(() => {
      useAuctionStore.setState({ connectionStatus: 'connected' });
    });

    const { result } = renderHook(() => useBidStream(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionStatus).toBe('connected');
  });

  it('reports velocity from bid timestamps within the rolling window', () => {
    const now = Date.now();
    act(() => {
      useAuctionStore.setState({
        bidTimestamps: [now - 5000, now - 15000, now - 120000],
      });
    });

    const { result } = renderHook(() => useBidStream(), {
      wrapper: createWrapper(queryClient),
    });

    // 2 timestamps within 60s window, 1 outside
    expect(result.current.velocity).toBe(2);
  });

  it('reports accelerating momentum when more recent bids than older', () => {
    const now = Date.now();
    act(() => {
      useAuctionStore.setState({
        bidTimestamps: [
          now - 1000,
          now - 5000,
          now - 10000,
          now - 20000,
          now - 45000,
        ],
      });
    });

    const { result } = renderHook(() => useBidStream(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.momentum).toBe('accelerating');
  });

  it('reports decelerating momentum when older bids dominate', () => {
    const now = Date.now();
    act(() => {
      useAuctionStore.setState({
        bidTimestamps: [
          now - 32000,
          now - 36000,
          now - 40000,
          now - 45000,
          now - 50000,
        ],
      });
    });

    const { result } = renderHook(() => useBidStream(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.momentum).toBe('decelerating');
  });

  it('produces a 6-bucket sparkline from bid timestamps', () => {
    const now = Date.now();
    // ages chosen to land in distinct buckets (10s wide each)
    act(() => {
      useAuctionStore.setState({
        bidTimestamps: [now - 5000, now - 25000, now - 55000, now - 90000],
      });
    });

    const { result } = renderHook(() => useBidStream(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.velocityBuckets).toHaveLength(6);
    const total = result.current.velocityBuckets.reduce((a, b) => a + b, 0);
    // 3 of the 4 timestamps are within the 60s window
    expect(total).toBe(3);
  });
});

describe('useOrderBook', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
    resetAuctionStore();
  });

  afterEach(() => {
    queryClient.clear();
    resetAuctionStore();
  });

  it('returns empty array when order book is empty', () => {
    const { result } = renderHook(() => useOrderBook(10000), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current).toEqual([]);
  });

  it('computes rank, percentage, and "just now" time for fresh entries', () => {
    const nowIso = new Date().toISOString();
    act(() => {
      useAuctionStore.setState({
        orderBook: [
          {
            id: 'b-1',
            provider_name: 'Alice',
            amount_cents: 5000,
            trust_score: 85,
            trust_tier: 'gold',
            created_at: nowIso,
            is_new: true,
          },
          {
            id: 'b-2',
            provider_name: 'Bob',
            amount_cents: 6000,
            trust_score: 70,
            trust_tier: 'silver',
            created_at: nowIso,
            is_new: false,
          },
        ],
      });
    });

    const { result } = renderHook(() => useOrderBook(10000), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current).toHaveLength(2);
    expect(result.current[0]?.rank).toBe(1);
    expect(result.current[1]?.rank).toBe(2);
    expect(result.current[0]?.percentage_of_total).toBe(50);
    expect(result.current[1]?.percentage_of_total).toBe(60);
    expect(result.current[0]?.time_since_bid).toBe('just now');
  });

  it('formats seconds, minutes, and hours timestamps', () => {
    const now = Date.now();
    act(() => {
      useAuctionStore.setState({
        orderBook: [
          {
            id: 's-30',
            provider_name: 'X',
            amount_cents: 1000,
            trust_score: 50,
            trust_tier: 'bronze',
            created_at: new Date(now - 30_000).toISOString(),
            is_new: false,
          },
          {
            id: 'm-5',
            provider_name: 'Y',
            amount_cents: 2000,
            trust_score: 50,
            trust_tier: 'bronze',
            created_at: new Date(now - 5 * 60_000).toISOString(),
            is_new: false,
          },
          {
            id: 'h-2',
            provider_name: 'Z',
            amount_cents: 3000,
            trust_score: 50,
            trust_tier: 'bronze',
            created_at: new Date(now - 2 * 3_600_000).toISOString(),
            is_new: false,
          },
        ],
      });
    });

    const { result } = renderHook(() => useOrderBook(10000), {
      wrapper: createWrapper(queryClient),
    });

    const seconds = result.current.find((e) => e.id === 's-30');
    const minutes = result.current.find((e) => e.id === 'm-5');
    const hours = result.current.find((e) => e.id === 'h-2');

    expect(seconds?.time_since_bid).toMatch(/\d+s ago/);
    expect(minutes?.time_since_bid).toMatch(/\d+m ago/);
    expect(hours?.time_since_bid).toMatch(/\d+h ago/);
  });

  it('falls back to 0 percentage when starting price is 0', () => {
    act(() => {
      useAuctionStore.setState({
        orderBook: [
          {
            id: 'z-1',
            provider_name: 'Zero',
            amount_cents: 1234,
            trust_score: 50,
            trust_tier: 'bronze',
            created_at: new Date().toISOString(),
            is_new: false,
          },
        ],
      });
    });

    const { result } = renderHook(() => useOrderBook(0), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current[0]?.percentage_of_total).toBe(0);
  });
});
