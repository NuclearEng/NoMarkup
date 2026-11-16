/**
 * Shared helpers for dashboard page smoke tests.
 *
 * These tests aim to verify that each page's default export renders without
 * throwing. Pages in `(dashboard)/` are heavyweight client components that
 * import many hooks, stores, and shared UI primitives — full behavior tests
 * live in component-specific specs (e.g. `tests/unit/components/contracts/`).
 * Here we just guard against import / render-time regressions.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, createElement } from 'react';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function withQueryClient(node: ReactElement, client?: QueryClient): ReactElement {
  const qc = client ?? createTestQueryClient();
  return createElement(QueryClientProvider, { client: qc }, node as ReactNode);
}
