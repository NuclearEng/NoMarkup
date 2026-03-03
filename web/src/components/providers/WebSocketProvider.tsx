'use client';

import { useWebSocket } from '@/hooks/useWebSocket';

/**
 * Initializes the WebSocket connection when the user is authenticated.
 * Mount this inside the dashboard layout (which requires auth) and
 * inside a QueryClientProvider so cache invalidation works.
 */
export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  useWebSocket();
  return <>{children}</>;
}
