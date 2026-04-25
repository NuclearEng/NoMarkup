import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  wsConnect: vi.fn(),
  wsDisconnect: vi.fn(),
  wsSubscribe: vi.fn(),
  wsUnsubscribe: vi.fn(),
  wsOn: vi.fn(),
  wsOff: vi.fn(),
}));

const CONNECTION_STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  ERROR: 'error',
} as const;

// Mock the websocket module before importing the store
vi.mock('@/lib/websocket', () => ({
  CONNECTION_STATUS: {
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    ERROR: 'error',
  },
  wsManager: {
    connect: mocks.wsConnect,
    disconnect: mocks.wsDisconnect,
    subscribe: mocks.wsSubscribe,
    unsubscribe: mocks.wsUnsubscribe,
    on: mocks.wsOn,
    off: mocks.wsOff,
  },
}));

const { useChatStore } = await import('@/stores/chat-store');

describe('useChatStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to initial state between tests
    useChatStore.setState({
      activeChannelId: null,
      connectionStatus: CONNECTION_STATUS.DISCONNECTED,
      typingUsers: {},
      _typingTimers: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts with no active channel', () => {
      expect(useChatStore.getState().activeChannelId).toBeNull();
    });

    it('starts disconnected', () => {
      expect(useChatStore.getState().connectionStatus).toBe(
        CONNECTION_STATUS.DISCONNECTED,
      );
    });

    it('starts with no typing users', () => {
      expect(useChatStore.getState().typingUsers).toEqual({});
    });
  });

  describe('setActiveChannel', () => {
    it('subscribes to the new channel via wsManager', () => {
      useChatStore.getState().setActiveChannel('channel-1');

      expect(mocks.wsSubscribe).toHaveBeenCalledWith('channel-1');
      expect(useChatStore.getState().activeChannelId).toBe('channel-1');
    });

    it('unsubscribes from the previous channel before subscribing to a new one', () => {
      useChatStore.getState().setActiveChannel('channel-1');
      vi.clearAllMocks();

      useChatStore.getState().setActiveChannel('channel-2');

      expect(mocks.wsUnsubscribe).toHaveBeenCalledWith('channel-1');
      expect(mocks.wsSubscribe).toHaveBeenCalledWith('channel-2');
      expect(useChatStore.getState().activeChannelId).toBe('channel-2');
    });

    it('does not double-subscribe when called with the same channel id', () => {
      useChatStore.getState().setActiveChannel('channel-1');
      vi.clearAllMocks();

      useChatStore.getState().setActiveChannel('channel-1');

      expect(mocks.wsSubscribe).not.toHaveBeenCalled();
      expect(mocks.wsUnsubscribe).not.toHaveBeenCalled();
    });

    it('only unsubscribes when clearing channel to null', () => {
      useChatStore.getState().setActiveChannel('channel-1');
      vi.clearAllMocks();

      useChatStore.getState().setActiveChannel(null);

      expect(mocks.wsUnsubscribe).toHaveBeenCalledWith('channel-1');
      expect(mocks.wsSubscribe).not.toHaveBeenCalled();
      expect(useChatStore.getState().activeChannelId).toBeNull();
    });

    it('does not call unsubscribe when there is no previous channel', () => {
      useChatStore.getState().setActiveChannel('channel-1');

      expect(mocks.wsUnsubscribe).not.toHaveBeenCalled();
      expect(mocks.wsSubscribe).toHaveBeenCalledWith('channel-1');
    });
  });

  describe('setConnectionStatus', () => {
    it('updates the connection status', () => {
      useChatStore
        .getState()
        .setConnectionStatus(CONNECTION_STATUS.CONNECTED);

      expect(useChatStore.getState().connectionStatus).toBe(
        CONNECTION_STATUS.CONNECTED,
      );
    });

    it('can transition through multiple statuses', () => {
      useChatStore
        .getState()
        .setConnectionStatus(CONNECTION_STATUS.CONNECTING);
      expect(useChatStore.getState().connectionStatus).toBe(
        CONNECTION_STATUS.CONNECTING,
      );

      useChatStore
        .getState()
        .setConnectionStatus(CONNECTION_STATUS.CONNECTED);
      expect(useChatStore.getState().connectionStatus).toBe(
        CONNECTION_STATUS.CONNECTED,
      );

      useChatStore.getState().setConnectionStatus(CONNECTION_STATUS.ERROR);
      expect(useChatStore.getState().connectionStatus).toBe(
        CONNECTION_STATUS.ERROR,
      );
    });
  });

  describe('addTypingUser', () => {
    it('adds a typing user to the channel', () => {
      useChatStore.getState().addTypingUser('channel-1', 'user-a');

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([
        'user-a',
      ]);
    });

    it('supports multiple typing users in the same channel', () => {
      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      useChatStore.getState().addTypingUser('channel-1', 'user-b');
      useChatStore.getState().addTypingUser('channel-1', 'user-c');

      const typing = useChatStore.getState().typingUsers['channel-1'];
      expect(typing).toEqual(['user-a', 'user-b', 'user-c']);
    });

    it('does not duplicate a user already typing in the channel', () => {
      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      useChatStore.getState().addTypingUser('channel-1', 'user-a');

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([
        'user-a',
      ]);
    });

    it('tracks the same user as typing across multiple channels independently', () => {
      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      useChatStore.getState().addTypingUser('channel-2', 'user-a');

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([
        'user-a',
      ]);
      expect(useChatStore.getState().typingUsers['channel-2']).toEqual([
        'user-a',
      ]);
    });

    it('auto-removes the typing user after 3 seconds', () => {
      vi.useFakeTimers();

      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([
        'user-a',
      ]);

      vi.advanceTimersByTime(3000);

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([]);
    });

    it('resets the auto-remove timer when the same user types again', () => {
      vi.useFakeTimers();

      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      vi.advanceTimersByTime(2000);

      // Re-typing resets the timer to 3s from now
      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      vi.advanceTimersByTime(2000);

      // 4 seconds total elapsed but only 2s since reset — still typing
      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([
        'user-a',
      ]);

      vi.advanceTimersByTime(1000);
      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([]);
    });
  });

  describe('removeTypingUser', () => {
    it('removes a single user from the channel typing list', () => {
      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      useChatStore.getState().addTypingUser('channel-1', 'user-b');

      useChatStore.getState().removeTypingUser('channel-1', 'user-a');

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([
        'user-b',
      ]);
    });

    it('is a no-op when the user is not in the typing list', () => {
      useChatStore.getState().addTypingUser('channel-1', 'user-a');

      useChatStore.getState().removeTypingUser('channel-1', 'user-z');

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([
        'user-a',
      ]);
    });

    it('cancels the pending auto-remove timer for the user', () => {
      vi.useFakeTimers();

      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      useChatStore.getState().removeTypingUser('channel-1', 'user-a');

      // Advancing past the timeout should not throw or re-add the user
      vi.advanceTimersByTime(3000);

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([]);
    });
  });

  describe('clearTypingUsers', () => {
    it('clears all typing users in the channel', () => {
      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      useChatStore.getState().addTypingUser('channel-1', 'user-b');

      useChatStore.getState().clearTypingUsers('channel-1');

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([]);
    });

    it('does not affect typing users in other channels', () => {
      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      useChatStore.getState().addTypingUser('channel-2', 'user-b');

      useChatStore.getState().clearTypingUsers('channel-1');

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([]);
      expect(useChatStore.getState().typingUsers['channel-2']).toEqual([
        'user-b',
      ]);
    });

    it('cancels all pending auto-remove timers in the channel', () => {
      vi.useFakeTimers();

      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      useChatStore.getState().addTypingUser('channel-1', 'user-b');
      useChatStore.getState().clearTypingUsers('channel-1');

      vi.advanceTimersByTime(3000);

      expect(useChatStore.getState().typingUsers['channel-1']).toEqual([]);
    });
  });

  describe('subscribeToChannel', () => {
    it('delegates to wsManager.subscribe', () => {
      useChatStore.getState().subscribeToChannel('channel-x');

      expect(mocks.wsSubscribe).toHaveBeenCalledWith('channel-x');
    });

    it('does not change activeChannelId', () => {
      useChatStore.getState().subscribeToChannel('channel-x');

      expect(useChatStore.getState().activeChannelId).toBeNull();
    });
  });

  describe('unsubscribeFromChannel', () => {
    it('delegates to wsManager.unsubscribe', () => {
      useChatStore.getState().unsubscribeFromChannel('channel-x');

      expect(mocks.wsUnsubscribe).toHaveBeenCalledWith('channel-x');
    });
  });

  describe('connect', () => {
    it('calls wsManager.connect', () => {
      useChatStore.getState().connect();

      expect(mocks.wsConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect', () => {
    it('calls wsManager.disconnect', () => {
      useChatStore.getState().disconnect();

      expect(mocks.wsDisconnect).toHaveBeenCalledTimes(1);
    });

    it('resets connection status to DISCONNECTED', () => {
      useChatStore.setState({
        connectionStatus: CONNECTION_STATUS.CONNECTED,
      });

      useChatStore.getState().disconnect();

      expect(useChatStore.getState().connectionStatus).toBe(
        CONNECTION_STATUS.DISCONNECTED,
      );
    });

    it('clears all typing users on disconnect', () => {
      useChatStore.getState().addTypingUser('channel-1', 'user-a');
      useChatStore.getState().addTypingUser('channel-2', 'user-b');

      useChatStore.getState().disconnect();

      expect(useChatStore.getState().typingUsers).toEqual({});
    });
  });
});
