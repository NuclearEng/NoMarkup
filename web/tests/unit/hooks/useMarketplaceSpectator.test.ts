import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMarketplaceSpectator } from '@/hooks/useMarketplaceSpectator';
import type {
  MarketplaceBidEventData,
  MarketplaceConnectionStatus,
} from '@/lib/marketplace-spectator-websocket';

type BidListener = (event: MarketplaceBidEventData) => void;
type CountListener = (count: number) => void;
type ConnListener = (status: MarketplaceConnectionStatus) => void;

interface MockClient {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  __emitBid: (b: MarketplaceBidEventData) => void;
  __emitCount: (n: number) => void;
  __emitConn: (s: MarketplaceConnectionStatus) => void;
  __reset: () => void;
}

vi.mock('@/lib/marketplace-spectator-websocket', () => {
  const bidListeners = new Set<BidListener>();
  const countListeners = new Set<CountListener>();
  const connListeners = new Set<ConnListener>();

  const client: MockClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(
      (event: string, listener: BidListener | CountListener | ConnListener) => {
        if (event === 'bid') {
          const l = listener as BidListener;
          bidListeners.add(l);
          return () => {
            bidListeners.delete(l);
          };
        }
        if (event === 'spectator_count') {
          const l = listener as CountListener;
          countListeners.add(l);
          return () => {
            countListeners.delete(l);
          };
        }
        const l = listener as ConnListener;
        connListeners.add(l);
        // Match real-status replay so fresh subscribers see current state.
        l('disconnected');
        return () => {
          connListeners.delete(l);
        };
      },
    ),
    __emitBid: (b) => {
      bidListeners.forEach((l) => {
        l(b);
      });
    },
    __emitCount: (n) => {
      countListeners.forEach((l) => {
        l(n);
      });
    },
    __emitConn: (s) => {
      connListeners.forEach((l) => {
        l(s);
      });
    },
    __reset: () => {
      bidListeners.clear();
      countListeners.clear();
      connListeners.clear();
    },
  };

  return { marketplaceSpectatorClient: client };
});

const { marketplaceSpectatorClient } = (await import(
  '@/lib/marketplace-spectator-websocket'
)) as unknown as { marketplaceSpectatorClient: MockClient };

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useMarketplaceSpectator', () => {
  beforeEach(() => {
    marketplaceSpectatorClient.connect.mockClear();
    marketplaceSpectatorClient.disconnect.mockClear();
    marketplaceSpectatorClient.on.mockClear();
    marketplaceSpectatorClient.__reset();
    setVisibility('visible');
  });
  afterEach(() => {
    marketplaceSpectatorClient.__reset();
    setVisibility('visible');
  });

  it('returns disconnected default state when no listingId is supplied', () => {
    const { result } = renderHook(() => useMarketplaceSpectator(undefined));
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionStatus).toBe('disconnected');
    expect(result.current.lastBid).toBeNull();
    expect(result.current.watcherCount).toBe(0);
    expect(marketplaceSpectatorClient.connect).not.toHaveBeenCalled();
  });

  it('connects and subscribes to all three channels when given a listingId', () => {
    renderHook(() => useMarketplaceSpectator('listing-1'));

    expect(marketplaceSpectatorClient.connect).toHaveBeenCalledWith('listing-1');
    expect(marketplaceSpectatorClient.on).toHaveBeenCalledTimes(3);
    const events = marketplaceSpectatorClient.on.mock.calls.map((c) => String(c[0]));
    expect(events).toContain('bid');
    expect(events).toContain('spectator_count');
    expect(events).toContain('connection');
  });

  it('updates lastBid when a bid_event is emitted', () => {
    const { result } = renderHook(() => useMarketplaceSpectator('listing-1'));

    const bid: MarketplaceBidEventData = {
      type: 'bid_placed',
      listing_id: 'listing-1',
      amount_cents: 25_000,
      snipe_extension: false,
      snipe_extension_count: 0,
      new_auction_ends_at: null,
      timestamp: '2026-04-25T00:00:00Z',
    };

    act(() => {
      marketplaceSpectatorClient.__emitBid(bid);
    });

    expect(result.current.lastBid).toEqual(bid);
  });

  it('updates watcherCount when a spectator_count event is emitted', () => {
    const { result } = renderHook(() => useMarketplaceSpectator('listing-1'));

    act(() => {
      marketplaceSpectatorClient.__emitCount(31);
    });
    expect(result.current.watcherCount).toBe(31);

    act(() => {
      marketplaceSpectatorClient.__emitCount(45);
    });
    expect(result.current.watcherCount).toBe(45);
  });

  it('reflects connection status changes (isConnected flips on connected)', () => {
    const { result } = renderHook(() => useMarketplaceSpectator('listing-1'));

    expect(result.current.isConnected).toBe(false);

    act(() => {
      marketplaceSpectatorClient.__emitConn('connected');
    });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionStatus).toBe('connected');

    act(() => {
      marketplaceSpectatorClient.__emitConn('disconnected');
    });
    expect(result.current.isConnected).toBe(false);
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useMarketplaceSpectator('listing-1'));
    unmount();
    expect(marketplaceSpectatorClient.disconnect).toHaveBeenCalled();
  });

  it('disconnects + reconnects when listingId changes', () => {
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useMarketplaceSpectator(id),
      { initialProps: { id: 'listing-A' } },
    );

    expect(marketplaceSpectatorClient.connect).toHaveBeenLastCalledWith('listing-A');
    marketplaceSpectatorClient.connect.mockClear();
    marketplaceSpectatorClient.disconnect.mockClear();

    rerender({ id: 'listing-B' });
    expect(marketplaceSpectatorClient.disconnect).toHaveBeenCalled();
    expect(marketplaceSpectatorClient.connect).toHaveBeenCalledWith('listing-B');
  });

  it('does NOT connect when the document is hidden at mount time', () => {
    setVisibility('hidden');
    renderHook(() => useMarketplaceSpectator('listing-1'));
    expect(marketplaceSpectatorClient.connect).not.toHaveBeenCalled();
  });

  it('disconnects when the tab becomes hidden and reconnects when visible again', () => {
    renderHook(() => useMarketplaceSpectator('listing-1'));
    marketplaceSpectatorClient.connect.mockClear();
    marketplaceSpectatorClient.disconnect.mockClear();

    act(() => {
      setVisibility('hidden');
    });
    expect(marketplaceSpectatorClient.disconnect).toHaveBeenCalled();

    act(() => {
      setVisibility('visible');
    });
    expect(marketplaceSpectatorClient.connect).toHaveBeenCalledWith('listing-1');
  });

  it('resets lastBid and watcherCount when the listingId changes', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useMarketplaceSpectator(id),
      { initialProps: { id: 'listing-A' } },
    );

    act(() => {
      marketplaceSpectatorClient.__emitCount(10);
      marketplaceSpectatorClient.__emitBid({
        type: 'bid_placed',
        listing_id: 'listing-A',
        amount_cents: 100,
        snipe_extension: false,
        snipe_extension_count: 0,
        new_auction_ends_at: null,
        timestamp: '2026-04-25T00:00:00Z',
      });
    });
    expect(result.current.watcherCount).toBe(10);
    expect(result.current.lastBid).not.toBeNull();

    rerender({ id: 'listing-B' });

    expect(result.current.watcherCount).toBe(0);
    expect(result.current.lastBid).toBeNull();
  });
});
