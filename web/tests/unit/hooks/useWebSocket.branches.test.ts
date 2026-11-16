// useWebSocket — the branches useWebSocket.test.ts leaves untested: the
// first-connect vs RECONNECT distinction (only a reconnect backfills the
// caches), the read-receipt cache patch (every shape of cached channel), the
// auth transitions after mount, listener teardown, and the exact typing
// debounce boundary.
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSendTypingIndicator, useWebSocket } from '@/hooks/useWebSocket';

const ws = vi.hoisted(() => {
  const messageListeners = new Set<(msg: unknown) => void>();
  const statusListeners = new Set<(status: string) => void>();
  return {
    messageListeners,
    statusListeners,
    sendTyping: vi.fn<(channelId: string) => void>(),
  };
});

vi.mock('@/lib/websocket', () => ({
  WS_SERVER_MSG: {
    MESSAGE: 'message',
    TYPING: 'typing',
    UNREAD_UPDATE: 'unread_update',
    READ_RECEIPT: 'read_receipt',
  },
  CONNECTION_STATUS: {
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
  },
  wsManager: {
    onMessage: (cb: (msg: unknown) => void) => {
      ws.messageListeners.add(cb);
      return () => {
        ws.messageListeners.delete(cb);
      };
    },
    onStatusChange: (cb: (status: string) => void) => {
      ws.statusListeners.add(cb);
      return () => {
        ws.statusListeners.delete(cb);
      };
    },
    sendTyping: ws.sendTyping,
  },
}));

const authState = { isAuthenticated: false, isHydrating: true };
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: <T,>(selector: (s: typeof authState) => T) => selector(authState),
}));

const chatActions = {
  setConnectionStatus: vi.fn<(status: string) => void>(),
  addTypingUser: vi.fn<(channelId: string, userId: string) => void>(),
  connect: vi.fn<() => void>(),
  disconnect: vi.fn<() => void>(),
};
vi.mock('@/stores/chat-store', () => ({
  useChatStore: <T,>(selector: (s: typeof chatActions) => T) => selector(chatActions),
}));

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function emitStatus(status: string): void {
  act(() => {
    for (const listener of ws.statusListeners) listener(status);
  });
}

function emitMessage(msg: Record<string, unknown>): void {
  act(() => {
    for (const listener of ws.messageListeners) listener(msg);
  });
}

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map(([filters]) => (filters as { queryKey?: unknown }).queryKey);
}

describe('useWebSocket branches', () => {
  let queryClient: QueryClient;

  function mount() {
    return renderHook(
      () => {
        useWebSocket();
      },
      { wrapper: createWrapper(queryClient) },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ws.messageListeners.clear();
    ws.statusListeners.clear();
    authState.isAuthenticated = false;
    authState.isHydrating = true;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('auth transitions', () => {
    it('connects once hydration finishes, then tears down and disconnects on sign-out', () => {
      const { rerender } = mount();
      expect(chatActions.connect).not.toHaveBeenCalled();
      expect(chatActions.disconnect).not.toHaveBeenCalled();

      authState.isHydrating = false;
      authState.isAuthenticated = true;
      rerender();
      expect(chatActions.connect).toHaveBeenCalledTimes(1);
      expect(chatActions.disconnect).not.toHaveBeenCalled();

      authState.isAuthenticated = false;
      rerender();
      // Once for the previous effect's cleanup, once for the signed-out branch.
      expect(chatActions.disconnect).toHaveBeenCalledTimes(2);
      expect(chatActions.connect).toHaveBeenCalledTimes(1);
    });

    it('does not disconnect on unmount when it never left the hydrating state', () => {
      const { unmount } = mount();
      unmount();
      expect(chatActions.disconnect).not.toHaveBeenCalled();
    });

    it('removes both wsManager listeners on unmount', () => {
      const { unmount } = mount();
      expect(ws.statusListeners.size).toBe(1);
      expect(ws.messageListeners.size).toBe(1);

      unmount();

      expect(ws.statusListeners.size).toBe(0);
      expect(ws.messageListeners.size).toBe(0);
    });
  });

  describe('connection status', () => {
    it('does not refetch on the very first connect', () => {
      mount();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      emitStatus('connecting');
      emitStatus('connected');

      expect(chatActions.setConnectionStatus.mock.calls).toEqual([['connecting'], ['connected']]);
      expect(spy).not.toHaveBeenCalled();
    });

    it('backfills messages, channels and unread-count on a RECONNECT only', () => {
      mount();
      emitStatus('connected');
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      emitStatus('disconnected');
      emitStatus('connecting');
      expect(spy).not.toHaveBeenCalled();

      emitStatus('connected');
      expect(invalidatedKeys(spy)).toEqual([['messages'], ['channels'], ['unread-count']]);
      expect(chatActions.setConnectionStatus).toHaveBeenLastCalledWith('connected');
    });
  });

  describe('read receipts', () => {
    const channel = {
      id: 'ch-1',
      customer_id: 'cust-1',
      provider_id: 'prov-1',
      customer_last_read_at: '2026-01-01T00:00:00Z',
      provider_last_read_at: '2026-01-01T00:00:00Z',
    };
    const stamp = '2026-02-02T10:00:00Z';

    function receipt(fields: Record<string, unknown>): Record<string, unknown> {
      return { type: 'read_receipt', channel_id: 'ch-1', ...fields };
    }

    it.each([
      {
        name: 'the customer read → customer watermark only',
        msg: receipt({ user_id: 'cust-1', last_read_at: stamp }),
        expected: { ...channel, customer_last_read_at: stamp },
      },
      {
        name: 'the provider read → provider watermark only',
        msg: receipt({ user_id: 'prov-1', last_read_at: stamp }),
        expected: { ...channel, provider_last_read_at: stamp },
      },
      {
        name: 'a user who is neither party → watermarks untouched',
        msg: receipt({ user_id: 'stranger', last_read_at: stamp }),
        expected: channel,
      },
      {
        name: 'no user id → watermarks untouched',
        msg: receipt({ user_id: '', last_read_at: stamp }),
        expected: channel,
      },
      {
        name: 'the customer, but no watermark in the frame → watermarks untouched',
        msg: receipt({ user_id: 'cust-1' }),
        expected: channel,
      },
      {
        name: 'the provider, but no watermark in the frame → watermarks untouched',
        msg: receipt({ user_id: 'prov-1' }),
        expected: channel,
      },
    ])('$name', ({ msg, expected }) => {
      const cached = { channel, extra: 'kept' };
      queryClient.setQueryData(['channel', 'ch-1'], cached);
      mount();

      emitMessage(msg);

      expect(queryClient.getQueryData(['channel', 'ch-1'])).toEqual({
        channel: expected,
        extra: 'kept',
      });
    });

    it('keeps the cached object identity when the reader role cannot be resolved', () => {
      const cached = { channel };
      queryClient.setQueryData(['channel', 'ch-1'], cached);
      mount();

      emitMessage(receipt({ user_id: 'stranger', last_read_at: stamp }));

      expect(queryClient.getQueryData(['channel', 'ch-1'])).toBe(cached);
    });

    it.each([
      { name: 'a non-object cache entry', cached: 'not-an-object' },
      { name: 'an entry with no channel', cached: { other: 1 } },
      { name: 'an entry whose channel is not an object', cached: { channel: 'ch-1' } },
    ])('leaves $name exactly as it was', ({ cached }) => {
      queryClient.setQueryData(['channel', 'ch-1'], cached);
      mount();

      emitMessage(receipt({ user_id: 'cust-1', last_read_at: stamp }));

      expect(queryClient.getQueryData(['channel', 'ch-1'])).toBe(cached);
    });

    it('does not create a cache entry when the channel was never fetched', () => {
      mount();

      emitMessage(receipt({ user_id: 'cust-1', last_read_at: stamp }));

      expect(queryClient.getQueryData(['channel', 'ch-1'])).toBeUndefined();
    });

    it('only patches the channel named in the frame', () => {
      const other = { channel: { ...channel, id: 'ch-2' } };
      queryClient.setQueryData(['channel', 'ch-1'], { channel });
      queryClient.setQueryData(['channel', 'ch-2'], other);
      mount();

      emitMessage(receipt({ user_id: 'cust-1', last_read_at: stamp }));

      expect(queryClient.getQueryData(['channel', 'ch-2'])).toBe(other);
    });

    it('always invalidates the channel and the channel list, patched or not', () => {
      mount();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      emitMessage(receipt({ user_id: 'stranger', last_read_at: stamp }));

      expect(invalidatedKeys(spy)).toEqual([['channel', 'ch-1'], ['channels']]);
    });
  });

  describe('other frames', () => {
    it('ignores a frame type it does not know', () => {
      mount();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      emitMessage({ type: 'presence', channel_id: 'ch-1', user_id: 'u-1' });

      expect(spy).not.toHaveBeenCalled();
      expect(chatActions.addTypingUser).not.toHaveBeenCalled();
    });

    it('a typing frame touches the chat store and no query cache', () => {
      mount();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      emitMessage({ type: 'typing', channel_id: 'ch-7', user_id: 'u-3' });

      expect(chatActions.addTypingUser.mock.calls).toEqual([['ch-7', 'u-3']]);
      expect(spy).not.toHaveBeenCalled();
    });

    it('a message frame invalidates exactly its four keys, in order', () => {
      mount();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      emitMessage({ type: 'message', channel_id: 'ch-7' });

      expect(invalidatedKeys(spy)).toEqual([
        ['messages', 'ch-7'],
        ['channels'],
        ['channel', 'ch-7'],
        ['unread-count'],
      ]);
    });
  });
});

describe('useSendTypingIndicator debounce boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('suppresses a call at 299ms and sends again at exactly 300ms', () => {
    const { result } = renderHook(() => useSendTypingIndicator('ch-1'));

    result.current();
    vi.advanceTimersByTime(299);
    result.current();
    expect(ws.sendTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    result.current();
    expect(ws.sendTyping.mock.calls).toEqual([['ch-1'], ['ch-1']]);
  });

  it('starts sending once a channel is selected and targets the new channel', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useSendTypingIndicator(id),
      { initialProps: { id: null as string | null } },
    );

    result.current();
    expect(ws.sendTyping).not.toHaveBeenCalled();

    rerender({ id: 'ch-9' });
    result.current();
    expect(ws.sendTyping.mock.calls).toEqual([['ch-9']]);
  });
});
