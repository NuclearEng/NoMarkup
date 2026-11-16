import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUpdateOffer } from '@/hooks/useOffers';

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

describe('useUpdateOffer', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('sends offer-${action}:${offerId} Idempotency-Key and clears it on success', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ offer: { id: 'off-1' } });
    const { result } = renderHook(() => useUpdateOffer('list-1'), { wrapper: wrap(client) });
    result.current.mutate({ offerId: 'off-1', action: 'accept' });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(api.patch).toHaveBeenCalledWith(
      '/api/v1/offers/off-1',
      { action: 'accept', counter_amount_cents: 0, message: '' },
      { 'Idempotency-Key': 'offer-accept:off-1' },
    );
    expect(clearIdempotencyKey).toHaveBeenCalledWith('offer-accept:off-1');
  });
});
