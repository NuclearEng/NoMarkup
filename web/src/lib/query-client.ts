import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api';

/**
 * Shared singleton QueryClient. Lives in a plain module (not the provider
 * component) so non-React code — e.g. the auth store's logout action — can
 * clear per-user cached data on account switch. Without clearing on logout,
 * one user's cached notifications/etc. leak into the next session in the same
 * tab, which surfaced as a "notification not found" 404 when marking a stale,
 * previous-user notification as read.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: (failureCount, error) => {
        // Don't retry on 4xx/5xx server errors — they won't resolve on retry.
        if (error instanceof ApiError && error.status >= 400) return false;
        return failureCount < 1;
      },
    },
  },
});
