import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSendTypingIndicator, useWebSocket } from '@/hooks/useWebSocket';

// Mock the websocket singleton + reproduce the const exports the hook reads.
// Listeners are tracked so tests can fire fake messages/status changes through them.
vi.mock('@/lib/websocket', () => {
  const messageListeners = new Set<(msg: unknown) => void>();
  const statusListeners = new Set<(status: string) => void>();

  return {
    WS_SERVER_MSG: {
      MESSAGE: 'message',
      TYPING: 'typing',
      UNREAD_UPDATE: 'unread_update',
    },
    CONNECTION_STATUS: {
      CONNECTING: 'connecting',
      CONNECTED: 'connected',
      DISCONNECTED: 'disconnected',
    },
    wsManager: {
      onMessage: vi.fn((cb: (msg: unknown) => void) => {
        messageListeners.add(cb);
        return () => messageListeners.delete(cb);
      }),
      onStatusChange: vi.fn((cb: (status: string) => void) => {
        statusListeners.add(cb);
        return () => statusListeners.delete(cb);
      }),
      sendTyping: vi.fn(),
      __messageListeners: messageListeners,
      __statusListeners: statusListeners,
    },
  };
});

// Track current auth state, then return the result of the selector against it.
const authState = { isAuthenticated: false, isHydrating: true };
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: <T,>(selector: (s: typeof authState) => T) => selector(authState),
}));

const chatActions = {
  setConnectionStatus: vi.fn(),
  addTypingUser: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock('@/stores/chat-store', () => ({
  useChatStore: <T,>(selector: (s: typeof chatActions) => T) => selector(chatActions),
}));

const wsModule = await import('@/lib/websocket');
const wsManagerMock = wsModule.wsManager as unknown as {
  onMessage: ReturnType<typeof vi.fn>;
  onStatusChange: ReturnType<typeof vi.fn>;
  sendTyping: ReturnType<typeof vi.fn>;
  __messageListeners: Set<(msg: unknown) => void>;
  __statusListeners: Set<(status: string) => void>;
};

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useWebSocket', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    chatActions.setConnectionStatus.mockReset();
    chatActions.addTypingUser.mockReset();
    chatActions.connect.mockReset();
    chatActions.disconnect.mockReset();
    wsManagerMock.onMessage.mockClear();
    wsManagerMock.onStatusChange.mockClear();
    wsManagerMock.sendTyping.mockClear();
    wsManagerMock.__messageListeners.clear();
    wsManagerMock.__statusListeners.clear();
    authState.isAuthenticated = false;
    authState.isHydrating = true;
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('does nothing while auth is still hydrating', () => {
    authState.isHydrating = true;
    authState.isAuthenticated = false;

    renderHook(() => { useWebSocket(); }, { wrapper: createWrapper(queryClient) });

    expect(chatActions.connect).not.toHaveBeenCalled();
    expect(chatActions.disconnect).not.toHaveBeenCalled();
  });

  it('calls connect() once auth is hydrated and the user is authenticated', () => {
    authState.isHydrating = false;
    authState.isAuthenticated = true;

    renderHook(() => { useWebSocket(); }, { wrapper: createWrapper(queryClient) });

    expect(chatActions.connect).toHaveBeenCalledTimes(1);
  });

  it('calls disconnect() when hydrated but unauthenticated', () => {
    authState.isHydrating = false;
    authState.isAuthenticated = false;

    renderHook(() => { useWebSocket(); }, { wrapper: createWrapper(queryClient) });

    expect(chatActions.disconnect).toHaveBeenCalled();
    expect(chatActions.connect).not.toHaveBeenCalled();
  });

  it('disconnects on unmount', () => {
    authState.isHydrating = false;
    authState.isAuthenticated = true;

    const { unmount } = renderHook(() => { useWebSocket(); }, {
      wrapper: createWrapper(queryClient),
    });
    chatActions.disconnect.mockClear();
    unmount();

    expect(chatActions.disconnect).toHaveBeenCalled();
  });

  it('subscribes to status + message listeners on mount', () => {
    renderHook(() => { useWebSocket(); }, { wrapper: createWrapper(queryClient) });

    expect(wsManagerMock.onStatusChange).toHaveBeenCalledTimes(1);
    expect(wsManagerMock.onMessage).toHaveBeenCalledTimes(1);
  });

  it('forwards status changes to the chat store', () => {
    renderHook(() => { useWebSocket(); }, { wrapper: createWrapper(queryClient) });

    act(() => {
      for (const listener of wsManagerMock.__statusListeners) {
        listener('connected');
      }
    });

    expect(chatActions.setConnectionStatus).toHaveBeenCalledWith('connected');
  });

  it('invalidates message + channel + unread caches on incoming MESSAGE', () => {
    renderHook(() => { useWebSocket(); }, { wrapper: createWrapper(queryClient) });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      for (const listener of wsManagerMock.__messageListeners) {
        listener({ type: 'message', channel_id: 'ch-1' });
      }
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages', 'ch-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channels'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channel', 'ch-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['unread-count'] });
  });

  it('routes TYPING events to addTypingUser', () => {
    renderHook(() => { useWebSocket(); }, { wrapper: createWrapper(queryClient) });

    act(() => {
      for (const listener of wsManagerMock.__messageListeners) {
        listener({ type: 'typing', channel_id: 'ch-1', user_id: 'u-9' });
      }
    });

    expect(chatActions.addTypingUser).toHaveBeenCalledWith('ch-1', 'u-9');
  });

  it('invalidates unread + channel caches on UNREAD_UPDATE', () => {
    renderHook(() => { useWebSocket(); }, { wrapper: createWrapper(queryClient) });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      for (const listener of wsManagerMock.__messageListeners) {
        listener({ type: 'unread_update', channel_id: 'ch-1', unread_count: 4 });
      }
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['unread-count'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channels'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['channel', 'ch-1'] });
  });
});

describe('useSendTypingIndicator', () => {
  beforeEach(() => {
    wsManagerMock.sendTyping.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a typing message immediately on first call', () => {
    const { result } = renderHook(() => useSendTypingIndicator('ch-1'));

    act(() => { result.current(); });

    expect(wsManagerMock.sendTyping).toHaveBeenCalledWith('ch-1');
    expect(wsManagerMock.sendTyping).toHaveBeenCalledTimes(1);
  });

  it('debounces back-to-back calls within the debounce window', () => {
    const { result } = renderHook(() => useSendTypingIndicator('ch-1'));

    act(() => { result.current(); });
    act(() => { result.current(); });
    act(() => { result.current(); });

    expect(wsManagerMock.sendTyping).toHaveBeenCalledTimes(1);
  });

  it('allows another send once the debounce window elapses', () => {
    const { result } = renderHook(() => useSendTypingIndicator('ch-1'));

    act(() => { result.current(); });
    act(() => { vi.advanceTimersByTime(400); });
    act(() => { result.current(); });

    expect(wsManagerMock.sendTyping).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when channelId is null', () => {
    const { result } = renderHook(() => useSendTypingIndicator(null));

    act(() => { result.current(); });

    expect(wsManagerMock.sendTyping).not.toHaveBeenCalled();
  });
});
