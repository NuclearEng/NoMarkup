// auction-store — the token getter / refresher handed to the WebSocket
// manager, per-bid flash expiry, and stale or future-dated timestamps in the
// velocity and momentum selectors.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ws = vi.hoisted(() => ({
  connect:
    vi.fn<
      (
        jobId: string,
        token: string,
        tokenGetter?: () => string | null,
        tokenRefresher?: () => Promise<boolean>,
      ) => void
    >(),
  disconnect: vi.fn<() => void>(),
}));

const auth = vi.hoisted(() => ({
  accessToken: 'token-at-connect' as string | null,
  refreshToken: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('@/lib/auction-websocket', () => ({
  auctionWsManager: {
    connect: ws.connect,
    disconnect: ws.disconnect,
    onStatusChange: vi.fn(),
    getStatus: vi.fn(() => 'disconnected'),
  },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ accessToken: auth.accessToken, refreshToken: auth.refreshToken }),
  },
}));

const { useAuctionStore, getBidVelocity, getMomentum, getVelocityBuckets } = await import(
  '@/stores/auction-store'
);

const NOW = new Date('2026-04-25T12:00:00Z').getTime();

function entry(id: string, amount: number) {
  return {
    id,
    provider_name: `Provider ${id}`,
    amount_cents: amount,
    trust_score: 80,
    trust_tier: 'trusted',
    created_at: '2026-04-25T12:00:00Z',
  };
}

function withTimestamps(bidTimestamps: number[]) {
  return { ...useAuctionStore.getState(), bidTimestamps };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  auth.accessToken = 'token-at-connect';
  useAuctionStore.getState().clearActiveJob();
});

afterEach(() => {
  useAuctionStore.getState().clearActiveJob();
  vi.useRealTimers();
});

describe('setActiveJob — token callbacks given to the socket manager', () => {
  it('passes a getter that reads the auth store at call time, not the token it connected with', () => {
    useAuctionStore.getState().setActiveJob('job-1', 'token-at-connect');

    expect(ws.connect).toHaveBeenCalledTimes(1);
    const [jobId, token, tokenGetter] = ws.connect.mock.calls[0] ?? [];
    expect(jobId).toBe('job-1');
    expect(token).toBe('token-at-connect');

    auth.accessToken = 'token-after-refresh';
    expect(tokenGetter?.()).toBe('token-after-refresh');
    auth.accessToken = null;
    expect(tokenGetter?.()).toBeNull();
  });

  it('passes a refresher that delegates to the auth store and returns its result', async () => {
    auth.refreshToken.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    useAuctionStore.getState().setActiveJob('job-1', 'token-at-connect');
    const tokenRefresher = ws.connect.mock.calls[0]?.[3];

    await expect(tokenRefresher?.()).resolves.toBe(true);
    await expect(tokenRefresher?.()).resolves.toBe(false);
    expect(auth.refreshToken).toHaveBeenCalledTimes(2);
  });

  it('does not reconnect when asked for the job that is already active', () => {
    useAuctionStore.getState().setActiveJob('job-1', 'token-at-connect');
    useAuctionStore.getState().setActiveJob('job-1', 'another-token');

    expect(ws.connect).toHaveBeenCalledTimes(1);
  });
});

describe('order book flash', () => {
  it('expires each bid’s "new" flag on its own 2s timer', () => {
    const store = useAuctionStore.getState();
    store.addOrderBookEntry(entry('a', 50_000));
    vi.advanceTimersByTime(1_000);
    store.addOrderBookEntry(entry('b', 40_000));

    vi.advanceTimersByTime(1_000);
    expect(useAuctionStore.getState().orderBook.map((e) => [e.id, e.is_new])).toEqual([
      ['b', true],
      ['a', false],
    ]);
    expect(Object.keys(useAuctionStore.getState().flashTimers)).toEqual(['b']);

    vi.advanceTimersByTime(1_000);
    expect(useAuctionStore.getState().orderBook.every((e) => !e.is_new)).toBe(true);
    expect(useAuctionStore.getState().flashTimers).toEqual({});
  });

  it('clearFlash for an unknown id leaves every entry untouched', () => {
    const store = useAuctionStore.getState();
    store.addOrderBookEntry(entry('a', 50_000));

    store.clearFlash('nope');

    expect(useAuctionStore.getState().orderBook).toEqual([{ ...entry('a', 50_000), is_new: true }]);
    expect(Object.keys(useAuctionStore.getState().flashTimers)).toEqual(['a']);
  });
});

describe('velocity selectors', () => {
  it('getVelocityBuckets skips stale and future-dated timestamps', () => {
    const state = withTimestamps([
      NOW - 1_000, // newest bucket (last)
      NOW - 35_000, // 30-40s old
      NOW - 60_000, // exactly on the window edge → oldest bucket
      NOW - 60_001, // stale
      NOW + 15_000, // future (clock skew)
    ]);

    expect(getVelocityBuckets(state)).toEqual([1, 0, 1, 0, 0, 1]);
  });

  it('getBidVelocity counts everything from the last 60s, including the window edge', () => {
    const state = withTimestamps([NOW - 1_000, NOW - 60_000, NOW - 60_001]);
    expect(getBidVelocity(state)).toBe(2);
  });

  it.each([
    ['accelerating when the recent half leads by more than one', [1_000, 2_000, 3_000, 45_000], 'accelerating'],
    ['decelerating when the older half leads by more than one', [31_000, 40_000, 50_000, 5_000], 'decelerating'],
    ['stable when the halves differ by one', [1_000, 2_000, 45_000], 'stable'],
    ['stable when only stale bids exist', [61_000, 90_000, 120_000], 'stable'],
    ['unaffected by stale bids', [1_000, 2_000, 3_000, 61_000, 62_000, 63_000], 'accelerating'],
  ])('getMomentum is %s', (_name, ages, expected) => {
    expect(getMomentum(withTimestamps(ages.map((age) => NOW - age)))).toBe(expected);
  });
});
