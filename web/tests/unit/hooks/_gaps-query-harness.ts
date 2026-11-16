// Shared TanStack Query scaffolding for the hooks/*.gaps.test.ts files: a
// fresh client per test, a provider wrapper for renderHook, and a recorder for
// which query keys a mutation invalidated.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { vi } from 'vitest';

export interface QueryHarness {
  queryClient: QueryClient;
  wrapper: (props: { children: ReactNode }) => ReactNode;
  /** Query keys passed to `invalidateQueries`, in call order. */
  invalidatedKeys: () => unknown[];
}

export function createQueryHarness(): QueryHarness {
  const queryClient = new QueryClient({
    defaultOptions: {
      // `retryDelay: 0` only matters for hooks that pass their own `retry`.
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const spy = vi.spyOn(queryClient, 'invalidateQueries');
  return {
    queryClient,
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
    invalidatedKeys: () => spy.mock.calls.map((call) => call[0]?.queryKey),
  };
}
