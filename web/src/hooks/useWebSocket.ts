import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import {
  WS_SERVER_MSG,
  wsManager,
  type ConnectionStatus,
  type WsServerMessage,
} from '@/lib/websocket';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';

const TYPING_DEBOUNCE_MS = 300;

/**
 * Manages the WebSocket lifecycle and dispatches incoming events
 * to TanStack Query cache and the chat Zustand store.
 *
 * Must be mounted inside a QueryClientProvider and only when authenticated.
 */
export function useWebSocket(): void {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const setConnectionStatus = useChatStore((s) => s.setConnectionStatus);
  const addTypingUser = useChatStore((s) => s.addTypingUser);
  const connect = useChatStore((s) => s.connect);
  const disconnect = useChatStore((s) => s.disconnect);

  // ─── Connect / disconnect based on auth ─────────────────────────
  useEffect(() => {
    if (isAuthenticated) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // ─── Listen for connection status changes ───────────────────────
  useEffect(() => {
    const unsubscribe = wsManager.onStatusChange((status: ConnectionStatus) => {
      setConnectionStatus(status);
    });

    return unsubscribe;
  }, [setConnectionStatus]);

  // ─── Handle incoming WebSocket messages ─────────────────────────
  useEffect(() => {
    const unsubscribe = wsManager.onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case WS_SERVER_MSG.MESSAGE:
          // Invalidate messages for the relevant channel and the channels list
          void queryClient.invalidateQueries({ queryKey: ['messages', msg.channel_id] });
          void queryClient.invalidateQueries({ queryKey: ['channels'] });
          void queryClient.invalidateQueries({ queryKey: ['channel', msg.channel_id] });
          void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
          break;

        case WS_SERVER_MSG.TYPING:
          addTypingUser(msg.channel_id, msg.user_id);
          break;

        case WS_SERVER_MSG.UNREAD_UPDATE:
          void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
          void queryClient.invalidateQueries({ queryKey: ['channels'] });
          void queryClient.invalidateQueries({ queryKey: ['channel', msg.channel_id] });
          break;
      }
    });

    return unsubscribe;
  }, [queryClient, addTypingUser]);
}

/**
 * Returns a debounced function that sends a typing indicator for the given channel.
 * Guarantees at most one WebSocket typing message per `TYPING_DEBOUNCE_MS`.
 */
export function useSendTypingIndicator(channelId: string | null): () => void {
  const lastSentRef = useRef(0);

  return useCallback(() => {
    if (!channelId) return;

    const now = Date.now();
    if (now - lastSentRef.current < TYPING_DEBOUNCE_MS) return;

    lastSentRef.current = now;
    wsManager.sendTyping(channelId);
  }, [channelId]);
}
