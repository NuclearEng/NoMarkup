// useAuctionStream wires the auction WebSocket manager into the global auction
// Zustand store and re-derives velocity/momentum from bidTimestamps. We mock the
// WS manager (so connect/disconnect side effects no-op) and seed the real auth
// + auction stores so the hook actually exercises its subscribe/unsubscribe path.
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuctionStream } from '@/hooks/useAuctionStream';
import { useAuctionStore } from '@/stores/auction-store';
import { useAuthStore } from '@/stores/auth-store';
import type { AuctionMessage } from '@/lib/auction-websocket';

type MessageListener = (m: AuctionMessage) => void;
type StatusListener = (s: 'connecting' | 'connected' | 'disconnected') => void;

interface MockManager {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof vi.fn>;
  onStatusChange: ReturnType<typeof vi.fn>;
  __emitMessage: (m: AuctionMessage) => void;
  __reset: () => void;
}

vi.mock('@/lib/auction-websocket', () => {
  const messageListeners = new Set<MessageListener>();
  const statusListeners = new Set<StatusListener>();
  const manager: MockManager = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn((listener: MessageListener) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    }),
    onStatusChange: vi.fn((listener: StatusListener) => {
      statusListeners.add(listener);
      listener('disconnected');
      return () => statusListeners.delete(listener);
    }),
    __emitMessage: (m: AuctionMessage) => {
      messageListeners.forEach((l) => {
        l(m);
      });
    },
    __reset: () => {
      messageListeners.clear();
      statusListeners.clear();
    },
  };
  return { auctionWsManager: manager };
});

const { auctionWsManager } = (await import('@/lib/auction-websocket')) as unknown as {
  auctionWsManager: MockManager;
};

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

describe('useAuctionStream', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = qc();
    auctionWsManager.connect.mockClear();
    auctionWsManager.disconnect.mockClear();
    auctionWsManager.onMessage.mockClear();
    auctionWsManager.__reset();
    resetAuctionStore();
    useAuthStore.setState({ accessToken: 'token-abc' });
  });

  afterEach(() => {
    client.clear();
    resetAuctionStore();
    useAuthStore.setState({ accessToken: null });
  });

  it('returns derived defaults when jobId is missing', () => {
    const { result } = renderHook(() => useAuctionStream(undefined), { wrapper: wrap(client) });

    expect(result.current.events).toEqual([]);
    expect(result.current.bidCount).toBe(0);
    expect(result.current.currentLowest).toBe(0);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.velocity).toBe(0);
    expect(result.current.momentum).toBe('stable');
    expect(result.current.velocityBuckets).toEqual([0, 0, 0, 0, 0, 0]);
    expect(auctionWsManager.connect).not.toHaveBeenCalled();
  });

  it('does not connect when accessToken is null even with a jobId', () => {
    useAuthStore.setState({ accessToken: null });
    renderHook(() => useAuctionStream('job-1'), { wrapper: wrap(client) });

    expect(auctionWsManager.connect).not.toHaveBeenCalled();
    expect(auctionWsManager.onMessage).not.toHaveBeenCalled();
  });

  it('subscribes to messages and triggers connect via the auction store', () => {
    renderHook(() => useAuctionStream('job-1'), { wrapper: wrap(client) });

    // setActiveJob in the auction store is what calls auctionWsManager.connect.
    expect(auctionWsManager.connect).toHaveBeenCalledWith(
      'job-1',
      'token-abc',
      expect.any(Function),
    );
    expect(auctionWsManager.onMessage).toHaveBeenCalledTimes(1);
    expect(useAuctionStore.getState().activeJobId).toBe('job-1');
  });

  it('routes bid_event messages into the auction store', () => {
    const { result } = renderHook(() => useAuctionStream('job-1'), { wrapper: wrap(client) });

    act(() => {
      auctionWsManager.__emitMessage({
        type: 'bid_event',
        data: {
          type: 'bid_placed',
          job_id: 'job-1',
          amount_cents: 12000,
          timestamp: '2026-04-25T00:00:00Z',
        },
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]?.amount_cents).toBe(12000);
  });

  it('clears the active job and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useAuctionStream('job-1'), { wrapper: wrap(client) });
    expect(useAuctionStore.getState().activeJobId).toBe('job-1');

    unmount();

    // clearActiveJob calls auctionWsManager.disconnect via the store action.
    expect(auctionWsManager.disconnect).toHaveBeenCalled();
    expect(useAuctionStore.getState().activeJobId).toBeNull();
  });
});
