// useBids — status-specific bid failure toasts (403 account gates, 409), the
// faster polling in the last five minutes of an auction, and future-dated
// bid timestamps in the velocity buckets.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBidStream, useLiveAuctionState, usePlaceBid } from '@/hooks/useBids';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  post: vi.fn<(path: string, body?: unknown, headers?: Record<string, string>) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: mocks.get, post: mocks.post, patch: vi.fn(), delete: vi.fn() } };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/auction-websocket', () => ({
  auctionWsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onStatusChange: vi.fn(),
    getStatus: vi.fn(() => 'disconnected'),
  },
}));

const { ApiError, __resetIdempotencyKeysForTests } = await import('@/lib/api');
const { toast } = await import('sonner');
const { useAuctionStore } = await import('@/stores/auction-store');

const NOW = new Date('2026-04-25T12:00:00Z');

let h: QueryHarness;

beforeEach(() => {
  vi.clearAllMocks();
  __resetIdempotencyKeysForTests();
  h = createQueryHarness();
});

afterEach(() => {
  vi.useRealTimers();
  h.queryClient.clear();
});

describe('usePlaceBid — failure toasts by status', () => {
  const variables = { jobId: 'job-1', input: { amount_cents: 40_000 } };

  const cases: { name: string; error: unknown; toast: string }[] = [
    {
      name: '403 with no account-gate code → role message',
      error: new ApiError(403, '{"error":"forbidden"}'),
      toast: 'Only providers can place bids on service jobs.',
    },
    {
      name: '403 phone_not_verified → the gateway’s verification message',
      error: new ApiError(403, '{"error":"Verify your phone to bid","code":"phone_not_verified"}'),
      toast: 'Verify your phone to bid',
    },
    {
      name: '409 → fixed conflict copy (not the raw gateway text)',
      error: new ApiError(409, '{"error":"duplicate key value violates unique constraint"}'),
      toast:
        'Bid rejected: you may already have an active bid, or the job/auction state no longer allows it.',
    },
    {
      name: 'other ApiError → gateway reason',
      error: new ApiError(422, '{"error":"bid must be lower than the current lowest"}'),
      toast: 'bid must be lower than the current lowest',
    },
    {
      name: 'non-API failure → fallback',
      error: new TypeError('Failed to fetch'),
      toast: 'Failed to place bid',
    },
  ];

  it.each(cases)('$name', async ({ error, toast: expected }) => {
    mocks.post.mockRejectedValue(error);
    const { result } = renderHook(() => usePlaceBid(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync(variables)).rejects.toBe(error);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(expected);
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.invalidatedKeys()).toEqual([]);
  });

  it('reuses the Idempotency-Key when the same bid is retried after a failure', async () => {
    mocks.post.mockRejectedValueOnce(new ApiError(502, '')).mockResolvedValueOnce({ id: 'bid-1' });
    const { result } = renderHook(() => usePlaceBid(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync(variables)).rejects.toBeInstanceOf(ApiError);
    await result.current.mutateAsync(variables);

    const keys = mocks.post.mock.calls.map((call) => call[2]?.['Idempotency-Key']);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);
    expect(mocks.post.mock.calls[0]?.[0]).toBe('/api/v1/jobs/job-1/bids');
  });
});

describe('useLiveAuctionState — adaptive polling', () => {
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function endsIn(ms: number): string {
    return new Date(NOW.getTime() + ms).toISOString();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.get.mockResolvedValue({ current_lowest_cents: 40_000 });
  });

  it('polls every 2s inside the last five minutes', async () => {
    renderHook(() => useLiveAuctionState('job-1', endsIn(4 * 60_000)), { wrapper: h.wrapper });
    await advance(0);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/jobs/job-1/auction/state');

    await advance(2_000);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    await advance(2_000);
    expect(mocks.get).toHaveBeenCalledTimes(3);
  });

  it('polls every 5s when more than five minutes remain', async () => {
    renderHook(() => useLiveAuctionState('job-1', endsIn(30 * 60_000)), { wrapper: h.wrapper });
    await advance(0);
    expect(mocks.get).toHaveBeenCalledTimes(1);

    await advance(4_000);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('fetches once and stops polling when the auction has already ended', async () => {
    renderHook(() => useLiveAuctionState('job-1', endsIn(-60_000)), { wrapper: h.wrapper });
    await advance(0);
    expect(mocks.get).toHaveBeenCalledTimes(1);

    await advance(30_000);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('does not fetch or poll without a job id', async () => {
    const { result } = renderHook(() => useLiveAuctionState(undefined, endsIn(60_000)), {
      wrapper: h.wrapper,
    });
    await advance(10_000);
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('useBidStream — velocity buckets', () => {
  it('buckets by age and leaves out future-dated and stale timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const now = NOW.getTime();
    act(() => {
      useAuctionStore.setState({
        bidTimestamps: [now - 1_000, now - 2_000, now - 25_000, now - 55_000, now - 70_000, now + 20_000],
      });
    });

    const { result } = renderHook(() => useBidStream());

    expect(result.current.velocityBuckets).toEqual([1, 0, 0, 1, 0, 2]);
  });
});
