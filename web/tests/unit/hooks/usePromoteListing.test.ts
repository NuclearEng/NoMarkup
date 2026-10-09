import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConfirmPromotion, useCreatePromotion } from '@/hooks/usePromoteListing';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => {
      toastSuccess(...a);
    },
    error: (...a: unknown[]) => {
      toastError(...a);
    },
  },
}));

vi.mock('@/lib/api', () => ({
  idempotencyHeader: (op?: string) => ({
    'Idempotency-Key': op ? `key-for-${op}` : 'test-key',
  }),
  clearIdempotencyKey: vi.fn(),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`API error ${String(status)}: ${body}`);
      this.status = status;
      this.body = body;
    }
    userMessage(fallback: string) {
      try {
        const parsed = JSON.parse(this.body) as { error?: string };
        if (parsed.error) return parsed.error;
      } catch {
        // not JSON
      }
      return fallback;
    }
  },
}));

const { api, clearIdempotencyKey } = (await import('@/lib/api')) as unknown as {
  api: {
    post: ReturnType<typeof vi.fn>;
  };
  clearIdempotencyKey: ReturnType<typeof vi.fn>;
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('usePromoteListing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('useCreatePromotion POSTs with sticky Idempotency-Key', async () => {
    api.post.mockResolvedValue({
      charge_id: 'charge-1',
      listing_id: 'listing-1',
      duration_hours: 24,
      amount_cents: 500,
      stripe_client_secret: 'dev_promote_listing-1',
      promoted_until_estimate: '2026-08-03T00:00:00Z',
      status: 'pending',
    });

    const qc = createTestQueryClient();
    const { result } = renderHook(() => useCreatePromotion('listing-1'), {
      wrapper: createWrapper(qc),
    });

    result.current.mutate({ duration_hours: 24 });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/listings/listing-1/promote',
      { duration_hours: 24 },
      { 'Idempotency-Key': 'key-for-promote:listing-1:24' },
    );
    expect(clearIdempotencyKey).toHaveBeenCalledWith('promote:listing-1:24');
  });

  it('useConfirmPromotion POSTs charge_id with sticky Idempotency-Key', async () => {
    api.post.mockResolvedValue({
      charge_id: 'charge-1',
      listing_id: 'listing-1',
      is_promoted: true,
      promoted_until: '2026-08-03T00:00:00Z',
      status: 'succeeded',
    });

    const qc = createTestQueryClient();
    const { result } = renderHook(() => useConfirmPromotion('listing-1'), {
      wrapper: createWrapper(qc),
    });

    result.current.mutate({ charge_id: 'charge-1' });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/listings/listing-1/promote/confirm',
      { charge_id: 'charge-1' },
      { 'Idempotency-Key': 'key-for-promote-confirm:listing-1:charge-1' },
    );
    expect(clearIdempotencyKey).toHaveBeenCalledWith('promote-confirm:listing-1:charge-1');
    expect(toastSuccess).toHaveBeenCalledWith('Listing promoted');
  });
});
