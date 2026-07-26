import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({
  post: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

class FakeApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API error ${String(status)}`);
  }
  userMessage(fallback: string): string {
    return this.body || fallback;
  }
}

vi.mock('@/lib/api', () => ({
  api: { post },
  idempotencyHeader: () => ({ 'Idempotency-Key': 'test-key' }),
  ApiError: FakeApiError,
}));

const { describeOrderPaymentFailure, useOrderPaymentIntent } = await import(
  '@/hooks/useOrderPayment'
);

const TOKEN = ['pi', '3Test', 'secret', 'abc'].join('_');

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('describeOrderPaymentFailure', () => {
  it.each([404, 405, 501])(
    'treats %s as "the route is not deployed yet", not a user error',
    (status) => {
      expect(describeOrderPaymentFailure(new FakeApiError(status, ''))).toMatch(
        /not available yet/i,
      );
    },
  );

  it('passes a 402 decline reason straight through', () => {
    expect(
      describeOrderPaymentFailure(new FakeApiError(402, 'Card declined by issuer.')),
    ).toBe('Card declined by issuer.');
  });

  it('explains a 409 as a stale order state', () => {
    expect(describeOrderPaymentFailure(new FakeApiError(409, ''))).toMatch(
      /no longer awaiting payment/i,
    );
  });

  it('explains a 403 as a wrong-party attempt', () => {
    expect(describeOrderPaymentFailure(new FakeApiError(403, ''))).toMatch(
      /only the buyer/i,
    );
  });

  it('explains a 503 as temporary', () => {
    expect(describeOrderPaymentFailure(new FakeApiError(503, ''))).toMatch(
      /temporarily unavailable/i,
    );
  });

  it('falls back for an unmapped status and for a non-API throw', () => {
    expect(describeOrderPaymentFailure(new FakeApiError(500, ''))).toMatch(
      /could not start the payment/i,
    );
    expect(describeOrderPaymentFailure('boom')).toMatch(
      /could not start the payment/i,
    );
  });
});

describe('useOrderPaymentIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs to the order pay route with an idempotency key', async () => {
    post.mockResolvedValue({ client_secret: TOKEN, total_cents: 1000 });
    const { result } = renderHook(() => useOrderPaymentIntent('order-9'), {
      wrapper,
    });

    result.current.mutate();

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(post).toHaveBeenCalledWith(
      '/api/v1/orders/order-9/pay',
      undefined,
      expect.objectContaining({ 'Idempotency-Key': expect.any(String) as string }),
    );
    expect(result.current.data?.total_cents).toBe(1000);
  });

  it('surfaces the failure to the caller rather than toasting over it', async () => {
    post.mockRejectedValue(new FakeApiError(404, ''));
    const { result } = renderHook(() => useOrderPaymentIntent('order-9'), {
      wrapper,
    });

    result.current.mutate();

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
