import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUpdateRecurring } from '@/hooks/useRecurring';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
  idempotencyHeader: (op?: string) => ({ 'Idempotency-Key': op ?? 'fresh' }),
  clearIdempotencyKey: vi.fn(),
  getApiErrorMessage: (_err: unknown, fb: string) => fb,
}));

const { api, clearIdempotencyKey } = (await import('@/lib/api')) as unknown as {
  api: { patch: ReturnType<typeof vi.fn> };
  clearIdempotencyKey: ReturnType<typeof vi.fn>;
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

describe('useUpdateRecurring', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('PATCHes auto_approve with a sticky idempotency key', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({
      config: { id: 'rec-1', auto_approve: true },
    });
    const { result } = renderHook(() => useUpdateRecurring(), { wrapper: wrap(client) });
    result.current.mutate({ contractId: 'c-1', auto_approve: true });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.patch).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/recurring',
      { auto_approve: true },
      { 'Idempotency-Key': 'recurring-config:c-1:true:' },
    );
    expect(clearIdempotencyKey).toHaveBeenCalledWith('recurring-config:c-1:true:');
  });

  it('PATCHes proposed_rate_cents as an integer', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({
      config: { id: 'rec-1', rate_cents: 15000 },
    });
    const { result } = renderHook(() => useUpdateRecurring(), { wrapper: wrap(client) });
    result.current.mutate({ contractId: 'c-1', proposed_rate_cents: 15000 });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.patch).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/recurring',
      { proposed_rate_cents: 15000 },
      { 'Idempotency-Key': 'recurring-config:c-1::15000' },
    );
  });
});
