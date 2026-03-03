import { create } from 'zustand';

import {
  CONNECTION_STATUS,
  wsManager,
  type ConnectionStatus,
} from '@/lib/websocket';

const TYPING_TIMEOUT_MS = 3000;

interface ChatState {
  activeChannelId: string | null;
  connectionStatus: ConnectionStatus;
  typingUsers: Record<string, string[]>;
  /** Tracks per-user timeout handles for auto-clearing typing state */
  _typingTimers: Record<string, Record<string, ReturnType<typeof setTimeout>>>;
}

interface ChatActions {
  setActiveChannel: (id: string | null) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  addTypingUser: (channelId: string, userId: string) => void;
  removeTypingUser: (channelId: string, userId: string) => void;
  clearTypingUsers: (channelId: string) => void;
  subscribeToChannel: (channelId: string) => void;
  unsubscribeFromChannel: (channelId: string) => void;
  connect: () => void;
  disconnect: () => void;
}

export const useChatStore = create<ChatState & ChatActions>()((set, get) => ({
  activeChannelId: null,
  connectionStatus: CONNECTION_STATUS.DISCONNECTED,
  typingUsers: {},
  _typingTimers: {},

  setActiveChannel: (id) => {
    const prev = get().activeChannelId;
    if (prev === id) return;

    // Unsubscribe from the previous channel
    if (prev) {
      wsManager.unsubscribe(prev);
    }

    set({ activeChannelId: id });

    // Subscribe to the new channel
    if (id) {
      wsManager.subscribe(id);
    }
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  addTypingUser: (channelId, userId) => {
    const state = get();
    const channelTyping = state.typingUsers[channelId] ?? [];

    // Clear any existing timer for this user in this channel
    const channelTimers = state._typingTimers[channelId];
    const existingTimer = channelTimers?.[userId];
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    // Set a new timer to auto-remove after TYPING_TIMEOUT_MS
    const timer = setTimeout(() => {
      get().removeTypingUser(channelId, userId);
    }, TYPING_TIMEOUT_MS);

    // Add user if not already present
    const updatedUsers = channelTyping.includes(userId)
      ? channelTyping
      : [...channelTyping, userId];

    set({
      typingUsers: { ...state.typingUsers, [channelId]: updatedUsers },
      _typingTimers: {
        ...state._typingTimers,
        [channelId]: {
          ...(state._typingTimers[channelId] ?? {}),
          [userId]: timer,
        },
      },
    });
  },

  removeTypingUser: (channelId, userId) => {
    const state = get();
    const channelTyping = state.typingUsers[channelId] ?? [];
    const filtered = channelTyping.filter((u) => u !== userId);

    // Clear the timer
    const channelTimers = state._typingTimers[channelId];
    const existingTimer = channelTimers?.[userId];
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    const updatedTimers = { ...(state._typingTimers[channelId] ?? {}) };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete updatedTimers[userId];

    set({
      typingUsers: { ...state.typingUsers, [channelId]: filtered },
      _typingTimers: { ...state._typingTimers, [channelId]: updatedTimers },
    });
  },

  clearTypingUsers: (channelId) => {
    const state = get();
    const channelTimers = state._typingTimers[channelId];
    if (channelTimers) {
      for (const timer of Object.values(channelTimers)) {
        clearTimeout(timer);
      }
    }

    set({
      typingUsers: { ...state.typingUsers, [channelId]: [] },
      _typingTimers: { ...state._typingTimers, [channelId]: {} },
    });
  },

  subscribeToChannel: (channelId) => {
    wsManager.subscribe(channelId);
  },

  unsubscribeFromChannel: (channelId) => {
    wsManager.unsubscribe(channelId);
  },

  connect: () => {
    wsManager.connect();
  },

  disconnect: () => {
    wsManager.disconnect();
    set({
      connectionStatus: CONNECTION_STATUS.DISCONNECTED,
      typingUsers: {},
      _typingTimers: {},
    });
  },
}));
