import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { AuctionBidEvent } from '@/types';

// Mock the auction-websocket manager BEFORE importing the store
vi.mock('@/lib/auction-websocket', () => ({
  auctionWsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onStatusChange: vi.fn(),
    getStatus: vi.fn(() => 'disconnected'),
  },
}));

// Mock the auth store (auction store reads accessToken from it)
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ accessToken: 'mock-token' })),
  },
}));

// Import after mocks are set up
const { useAuctionStore, getBidVelocity, getMomentum, getPriceHistory, getOrderBook, getVelocityBuckets } =
  await import('@/stores/auction-store');
const { auctionWsManager } = await import('@/lib/auction-websocket');

// Capture mock function references once. Accessing the methods via property
// reads inside test bodies trips @typescript-eslint/unbound-method; binding
// here gives us stable function references that lint cleanly.
// eslint-disable-next-line @typescript-eslint/unbound-method
const mockedConnect = vi.mocked(auctionWsManager.connect);
// eslint-disable-next-line @typescript-eslint/unbound-method
const mockedDisconnect = vi.mocked(auctionWsManager.disconnect);

// ── Helpers ──

function makeBidEvent(
  overrides: Partial<AuctionBidEvent> = {},
): AuctionBidEvent {
  return {
    job_id: 'job-1',
    amount_cents: 10_000,
    event_type: 'bid_placed',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const INITIAL_STATE = {
  activeJobId: null,
  connectionStatus: 'disconnected' as const,
  events: [],
  currentLowest: 0,
  bidCount: 0,
  auctionEndsAt: null,
  snipeExtensionCount: 0,
  orderBook: [],
  priceHistory: [],
  bidTimestamps: [],
  flashTimers: {},
};

describe('useAuctionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to initial state without nuking action functions
    useAuctionStore.setState({ ...INITIAL_STATE });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts disconnected with no active job', () => {
      const state = useAuctionStore.getState();
      expect(state.activeJobId).toBeNull();
      expect(state.connectionStatus).toBe('disconnected');
      expect(state.bidCount).toBe(0);
      expect(state.currentLowest).toBe(0);
      expect(state.orderBook).toEqual([]);
      expect(state.priceHistory).toEqual([]);
    });
  });

  describe('setActiveJob', () => {
    it('connects to websocket and resets state for a new job', () => {
      // Pre-fill state with stale data
      useAuctionStore.setState({
        ...INITIAL_STATE,
        activeJobId: 'old-job',
        currentLowest: 5_000,
        bidCount: 3,
        events: [makeBidEvent()],
      });

      useAuctionStore
        .getState()
        .setActiveJob('new-job', 'token-xyz');

      const state = useAuctionStore.getState();
      expect(state.activeJobId).toBe('new-job');
      expect(state.events).toEqual([]);
      expect(state.currentLowest).toBe(0);
      expect(state.bidCount).toBe(0);
      expect(mockedConnect).toHaveBeenCalledTimes(1);
      const calls = mockedConnect.mock.calls;
      const firstCall = calls[0];
      expect(firstCall).toBeDefined();
      if (firstCall) {
        expect(firstCall[0]).toBe('new-job');
        expect(firstCall[1]).toBe('token-xyz');
      }
    });

    it('is a no-op if the same job is already active', () => {
      useAuctionStore.setState({
        ...INITIAL_STATE,
        activeJobId: 'job-1',
      });

      useAuctionStore
        .getState()
        .setActiveJob('job-1', 'token');

      expect(mockedConnect).not.toHaveBeenCalled();
    });

    it('clears any pending flash timers when switching jobs', () => {
      vi.useFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

      // Add a fake flash timer to state
      const fakeTimer = setTimeout(() => undefined, 5_000);
      useAuctionStore.setState({
        ...INITIAL_STATE,
        activeJobId: 'job-old',
        flashTimers: { 'bid-1': fakeTimer },
      });

      useAuctionStore
        .getState()
        .setActiveJob('job-new', 'token');

      expect(clearSpy).toHaveBeenCalledWith(fakeTimer);
      expect(useAuctionStore.getState().flashTimers).toEqual({});
    });
  });

  describe('clearActiveJob', () => {
    it('disconnects websocket and resets all state', () => {
      useAuctionStore.setState({
        ...INITIAL_STATE,
        activeJobId: 'job-1',
        currentLowest: 9_000,
        bidCount: 5,
        events: [makeBidEvent()],
        connectionStatus: 'connected',
      });

      useAuctionStore.getState().clearActiveJob();

      const state = useAuctionStore.getState();
      expect(state.activeJobId).toBeNull();
      expect(state.connectionStatus).toBe('disconnected');
      expect(state.events).toEqual([]);
      expect(state.currentLowest).toBe(0);
      expect(state.bidCount).toBe(0);
      expect(mockedDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('addBidEvent', () => {
    it('appends bid_placed events and tracks the lowest bid', () => {
      const first = makeBidEvent({ amount_cents: 10_000 });
      const second = makeBidEvent({ amount_cents: 8_000 });
      const third = makeBidEvent({ amount_cents: 12_000 });

      useAuctionStore.getState().addBidEvent(first);
      useAuctionStore.getState().addBidEvent(second);
      useAuctionStore.getState().addBidEvent(third);

      const state = useAuctionStore.getState();
      expect(state.events).toHaveLength(3);
      expect(state.currentLowest).toBe(8_000);
    });

    it('does not lower currentLowest on bid_withdrawn', () => {
      useAuctionStore
        .getState()
        .addBidEvent(makeBidEvent({ amount_cents: 5_000 }));
      useAuctionStore.getState().addBidEvent(
        makeBidEvent({
          amount_cents: 1,
          event_type: 'bid_withdrawn',
        }),
      );

      const state = useAuctionStore.getState();
      expect(state.currentLowest).toBe(5_000);
      expect(state.events).toHaveLength(2);
    });

    it('appends to priceHistory only on bid_placed and bid_updated', () => {
      const placed = makeBidEvent({ amount_cents: 10_000 });
      const updated = makeBidEvent({
        amount_cents: 9_000,
        event_type: 'bid_updated',
      });
      const withdrawn = makeBidEvent({
        amount_cents: 1,
        event_type: 'bid_withdrawn',
      });

      useAuctionStore.getState().addBidEvent(placed);
      useAuctionStore.getState().addBidEvent(updated);
      useAuctionStore.getState().addBidEvent(withdrawn);

      const history = useAuctionStore.getState().priceHistory;
      expect(history).toHaveLength(2);
      const second = history[1];
      expect(second).toBeDefined();
      if (second) {
        expect(second.amount_cents).toBe(9_000);
        expect(second.running_min).toBe(9_000);
      }
    });

    it('keeps running_min monotonically non-increasing', () => {
      useAuctionStore
        .getState()
        .addBidEvent(makeBidEvent({ amount_cents: 10_000 }));
      useAuctionStore
        .getState()
        .addBidEvent(makeBidEvent({ amount_cents: 7_000 }));
      useAuctionStore
        .getState()
        .addBidEvent(makeBidEvent({ amount_cents: 12_000 }));

      const history = useAuctionStore.getState().priceHistory;
      expect(history.map((p) => p.running_min)).toEqual([
        10_000, 7_000, 7_000,
      ]);
    });

    it('records a bid timestamp for velocity tracking', () => {
      useAuctionStore.getState().addBidEvent(makeBidEvent());
      useAuctionStore.getState().addBidEvent(makeBidEvent());

      expect(useAuctionStore.getState().bidTimestamps).toHaveLength(2);
    });
  });

  describe('updateAuctionState', () => {
    it('updates auction-level fields without touching bid history', () => {
      useAuctionStore.setState({
        ...INITIAL_STATE,
        events: [makeBidEvent()],
      });

      useAuctionStore.getState().updateAuctionState({
        lowest_bid_cents: 7_500,
        bid_count: 9,
        auction_ends_at: '2026-04-25T10:00:00Z',
        snipe_extension_count: 2,
      });

      const state = useAuctionStore.getState();
      expect(state.currentLowest).toBe(7_500);
      expect(state.bidCount).toBe(9);
      expect(state.auctionEndsAt).toBe('2026-04-25T10:00:00Z');
      expect(state.snipeExtensionCount).toBe(2);
      expect(state.events).toHaveLength(1);
    });
  });

  describe('addOrderBookEntry', () => {
    it('adds a new entry sorted by price ascending', () => {
      vi.useFakeTimers();
      useAuctionStore.getState().addOrderBookEntry({
        id: 'bid-a',
        provider_name: 'A',
        amount_cents: 12_000,
        trust_score: 80,
        trust_tier: 'gold',
        created_at: new Date().toISOString(),
      });
      useAuctionStore.getState().addOrderBookEntry({
        id: 'bid-b',
        provider_name: 'B',
        amount_cents: 9_000,
        trust_score: 90,
        trust_tier: 'platinum',
        created_at: new Date().toISOString(),
      });
      useAuctionStore.getState().addOrderBookEntry({
        id: 'bid-c',
        provider_name: 'C',
        amount_cents: 11_000,
        trust_score: 70,
        trust_tier: 'silver',
        created_at: new Date().toISOString(),
      });

      const ob = useAuctionStore.getState().orderBook;
      expect(ob.map((e) => e.id)).toEqual([
        'bid-b',
        'bid-c',
        'bid-a',
      ]);
      // Each new entry flagged as is_new
      expect(ob.every((e) => e.is_new)).toBe(true);
    });

    it('replaces an entry with the same id (bid update)', () => {
      vi.useFakeTimers();
      const created = new Date().toISOString();
      useAuctionStore.getState().addOrderBookEntry({
        id: 'bid-x',
        provider_name: 'X',
        amount_cents: 12_000,
        trust_score: 80,
        trust_tier: 'gold',
        created_at: created,
      });
      useAuctionStore.getState().addOrderBookEntry({
        id: 'bid-x',
        provider_name: 'X',
        amount_cents: 8_000,
        trust_score: 80,
        trust_tier: 'gold',
        created_at: created,
      });

      const ob = useAuctionStore.getState().orderBook;
      expect(ob).toHaveLength(1);
      const first = ob[0];
      expect(first).toBeDefined();
      if (first) {
        expect(first.amount_cents).toBe(8_000);
      }
    });

    it('clears the is_new flash flag after the timeout', () => {
      vi.useFakeTimers();
      useAuctionStore.getState().addOrderBookEntry({
        id: 'bid-flash',
        provider_name: 'F',
        amount_cents: 7_000,
        trust_score: 80,
        trust_tier: 'gold',
        created_at: new Date().toISOString(),
      });

      const beforeOb = useAuctionStore.getState().orderBook;
      const beforeFirst = beforeOb[0];
      expect(beforeFirst).toBeDefined();
      if (beforeFirst) {
        expect(beforeFirst.is_new).toBe(true);
      }

      vi.advanceTimersByTime(2_500);

      const afterOb = useAuctionStore.getState().orderBook;
      const afterFirst = afterOb[0];
      expect(afterFirst).toBeDefined();
      if (afterFirst) {
        expect(afterFirst.is_new).toBe(false);
      }
      expect(useAuctionStore.getState().flashTimers).toEqual({});
    });
  });

  describe('clearFlash', () => {
    it('marks the entry as no longer new', () => {
      useAuctionStore.setState({
        ...INITIAL_STATE,
        orderBook: [
          {
            id: 'bid-1',
            provider_name: 'A',
            amount_cents: 5_000,
            trust_score: 80,
            trust_tier: 'gold',
            created_at: '2026-04-24T00:00:00Z',
            is_new: true,
          },
        ],
      });

      useAuctionStore.getState().clearFlash('bid-1');

      const ob = useAuctionStore.getState().orderBook;
      const first = ob[0];
      expect(first).toBeDefined();
      if (first) {
        expect(first.is_new).toBe(false);
      }
    });
  });

  describe('selectors', () => {
    it('getOrderBook returns the order book unchanged', () => {
      const state = useAuctionStore.getState();
      expect(getOrderBook(state)).toBe(state.orderBook);
    });

    it('getPriceHistory returns the price history unchanged', () => {
      const state = useAuctionStore.getState();
      expect(getPriceHistory(state)).toBe(state.priceHistory);
    });

    it('getBidVelocity counts bids in the last minute', () => {
      const now = Date.now();
      useAuctionStore.setState({
        ...INITIAL_STATE,
        bidTimestamps: [
          now - 5_000,
          now - 30_000,
          now - 90_000, // outside window
        ],
      });

      expect(getBidVelocity(useAuctionStore.getState())).toBe(2);
    });

    it('getMomentum reports ACCELERATING when recent half dominates', () => {
      const now = Date.now();
      useAuctionStore.setState({
        ...INITIAL_STATE,
        bidTimestamps: [
          // recent half (0-30s)
          now - 1_000,
          now - 5_000,
          now - 10_000,
          now - 20_000,
          // older half (30-60s)
          now - 50_000,
        ],
      });

      expect(getMomentum(useAuctionStore.getState())).toBe('accelerating');
    });

    it('getMomentum reports DECELERATING when older half dominates', () => {
      const now = Date.now();
      useAuctionStore.setState({
        ...INITIAL_STATE,
        bidTimestamps: [
          now - 1_000,
          now - 40_000,
          now - 45_000,
          now - 50_000,
          now - 55_000,
        ],
      });

      expect(getMomentum(useAuctionStore.getState())).toBe('decelerating');
    });

    it('getMomentum reports STABLE when both halves are similar', () => {
      const now = Date.now();
      useAuctionStore.setState({
        ...INITIAL_STATE,
        bidTimestamps: [now - 1_000, now - 40_000],
      });

      expect(getMomentum(useAuctionStore.getState())).toBe('stable');
    });

    it('getVelocityBuckets returns 6 buckets', () => {
      const now = Date.now();
      useAuctionStore.setState({
        ...INITIAL_STATE,
        bidTimestamps: [now - 5_000, now - 25_000],
      });
      const buckets = getVelocityBuckets(useAuctionStore.getState());
      expect(buckets).toHaveLength(6);
      expect(buckets.reduce((a, b) => a + b, 0)).toBe(2);
    });
  });
});
