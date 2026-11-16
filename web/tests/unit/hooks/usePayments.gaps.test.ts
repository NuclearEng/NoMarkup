// usePayments — sticky create-payment keys (one-shot vs recurring visit),
// process without a payment method, the instant-payout summary soft-fail,
// the embedded Stripe session mutation, and escrow release failures.
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCreatePaymentIdempotency,
  useCreatePayment,
  useCreateStripeAccountSession,
  useInstantPayoutSummary,
  useProcessPayment,
  useReleaseEscrow,
} from '@/hooks/usePayments';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  post: vi.fn<(path: string, body?: unknown, headers?: Record<string, string>) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: mocks.get, post: mocks.post } };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { ApiError, __resetIdempotencyKeysForTests } = await import('@/lib/api');
const { toast } = await import('sonner');

let h: QueryHarness;

function sentKeys(): (string | undefined)[] {
  return mocks.post.mock.calls.map((call) => call[2]?.['Idempotency-Key']);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetIdempotencyKeysForTests();
  h = createQueryHarness();
});

afterEach(() => {
  h.queryClient.clear();
});

describe('useCreatePayment — idempotency key lifetime', () => {
  it('one-shot payment (no milestone / visit): key is released after success', async () => {
    mocks.post.mockResolvedValue({ id: 'pay-1' });
    const { result } = renderHook(() => useCreatePayment(), { wrapper: h.wrapper });
    const input = { contract_id: 'c-1', amount_cents: 10_000 };

    await result.current.mutateAsync(input);
    await result.current.mutateAsync(input);

    expect(mocks.post).toHaveBeenCalledWith('/api/v1/payments', input, {
      'Idempotency-Key': expect.any(String) as string,
    });
    const [first, second] = sentKeys();
    expect(second).not.toBe(first);
    expect(toast.success).toHaveBeenCalledWith('Payment created');
    expect(h.invalidatedKeys()).toEqual([['payments'], ['payments']]);
  });

  it('recurring visit: key stays sticky after success until explicitly cleared', async () => {
    mocks.post.mockResolvedValue({ id: 'pay-1' });
    const { result } = renderHook(() => useCreatePayment(), { wrapper: h.wrapper });
    const input = { contract_id: 'c-1', amount_cents: 10_000, recurring_instance_id: 'visit-3' };

    await result.current.mutateAsync(input);
    await result.current.mutateAsync(input);
    clearCreatePaymentIdempotency(input);
    await result.current.mutateAsync(input);

    const [first, replay, afterClear] = sentKeys();
    expect(replay).toBe(first);
    expect(afterClear).not.toBe(first);
  });

  it('scopes the key by visit, milestone, and amount', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCreatePayment(), { wrapper: h.wrapper });
    const base = { contract_id: 'c-1', amount_cents: 10_000 };
    const inputs = [
      base,
      { ...base, milestone_id: 'm-1' },
      { ...base, recurring_instance_id: 'visit-3' },
      // A visit id takes precedence over a milestone id in the key.
      { ...base, recurring_instance_id: 'visit-3', milestone_id: 'm-1' },
      { ...base, amount_cents: 20_000 },
    ];

    for (const input of inputs) {
      await expect(result.current.mutateAsync(input)).rejects.toThrow('offline');
    }

    const [plain, milestone, visit, visitAndMilestone, otherAmount] = sentKeys();
    expect(new Set([plain, milestone, visit, otherAmount]).size).toBe(4);
    expect(visitAndMilestone).toBe(visit);
    expect(toast.error).toHaveBeenCalledWith('offline');
    expect(h.invalidatedKeys()).toEqual([]);
  });
});

describe('useProcessPayment', () => {
  it('sends an empty payment_method_id when the PaymentElement already confirmed', async () => {
    mocks.post.mockResolvedValue({ id: 'pay-1', status: 'escrow' });
    const { result } = renderHook(() => useProcessPayment(), { wrapper: h.wrapper });

    await result.current.mutateAsync({ paymentId: 'pay-1' });

    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1/payments/pay-1/process',
      { payment_method_id: '' },
      { 'Idempotency-Key': expect.any(String) as string },
    );
    expect(h.invalidatedKeys()).toEqual(expect.arrayContaining([['payments'], ['payment', 'pay-1']]));
  });

  it('passes an explicit payment method through', async () => {
    mocks.post.mockResolvedValue({ id: 'pay-1' });
    const { result } = renderHook(() => useProcessPayment(), { wrapper: h.wrapper });

    await result.current.mutateAsync({ paymentId: 'pay-1', payment_method_id: 'pm_9' });

    expect(mocks.post.mock.calls[0]?.[1]).toEqual({ payment_method_id: 'pm_9' });
  });
});

describe('useInstantPayoutSummary', () => {
  it('fetches by default', async () => {
    const summary = { available_cents: 12_300 };
    mocks.get.mockResolvedValue(summary);

    const { result } = renderHook(() => useInstantPayoutSummary(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/payments/instant-payout/summary');
    expect(h.queryClient.getQueryData(['instant-payout-summary'])).toEqual(summary);
  });

  it('resolves to null (no advertised balance) instead of erroring when the request fails', async () => {
    mocks.get.mockRejectedValue(new ApiError(503, '{"error":"feature disabled"}'));

    const { result } = renderHook(() => useInstantPayoutSummary(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('does not fetch when disabled', () => {
    const { result } = renderHook(() => useInstantPayoutSummary(false), { wrapper: h.wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('useCreateStripeAccountSession', () => {
  it('POSTs with no body and returns the single-use secret', async () => {
    mocks.post.mockResolvedValue({ client_secret: 'acct_sess_secret' });
    const { result } = renderHook(() => useCreateStripeAccountSession(), { wrapper: h.wrapper });

    const data = await result.current.mutateAsync();

    expect(mocks.post).toHaveBeenCalledWith('/api/v1/providers/me/stripe/account-session');
    expect(data).toEqual({ client_secret: 'acct_sess_secret' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts the gateway reason, or the fallback when there is none', async () => {
    mocks.post
      .mockRejectedValueOnce(new ApiError(409, '{"error":"Stripe account not created yet"}'))
      .mockRejectedValueOnce('nope');
    const { result } = renderHook(() => useCreateStripeAccountSession(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync()).rejects.toBeInstanceOf(ApiError);
    await expect(result.current.mutateAsync()).rejects.toBe('nope');

    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual([
      'Stripe account not created yet',
      'Failed to start embedded Stripe setup',
    ]);
  });
});

describe('useReleaseEscrow — failures', () => {
  it('maps a 409 proof-of-work conflict to the blocked-release sentence', async () => {
    mocks.post.mockRejectedValue(
      new ApiError(409, JSON.stringify({ error: 'proof of work required', missing: ['after_photo'] })),
    );
    const { result } = renderHook(() => useReleaseEscrow(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ paymentId: 'pay-1' })).rejects.toBeInstanceOf(ApiError);

    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1/payments/pay-1/release',
      { reason: 'customer approved completion' },
      { 'Idempotency-Key': expect.any(String) as string },
    );
    expect(toast.error).toHaveBeenCalledWith('Need an after photo before funds release');
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.invalidatedKeys()).toEqual([]);
  });

  it('shows the gateway reason for any other failure and keeps the key for a retry', async () => {
    mocks.post.mockRejectedValue(new ApiError(403, '{"error":"only the customer can release escrow"}'));
    const { result } = renderHook(() => useReleaseEscrow(), { wrapper: h.wrapper });
    const variables = { paymentId: 'pay-1', reason: 'work verified on site' };

    await expect(result.current.mutateAsync(variables)).rejects.toBeInstanceOf(ApiError);
    await expect(result.current.mutateAsync(variables)).rejects.toBeInstanceOf(ApiError);

    expect(mocks.post.mock.calls[0]?.[1]).toEqual({ reason: 'work verified on site' });
    expect(toast.error).toHaveBeenCalledWith('only the customer can release escrow');
    const [first, retry] = sentKeys();
    expect(retry).toBe(first);
  });

  it('a 409 that is not proof-of-work uses the generic path', async () => {
    mocks.post.mockRejectedValue(new ApiError(409, '{"error":"payment already released"}'));
    const { result } = renderHook(() => useReleaseEscrow(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ paymentId: 'pay-1' })).rejects.toBeInstanceOf(ApiError);

    expect(toast.error).toHaveBeenCalledWith('payment already released');
  });

  it('shows the fallback for a failure with no message', async () => {
    mocks.post.mockRejectedValue('nope');
    const { result } = renderHook(() => useReleaseEscrow(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ paymentId: 'pay-1' })).rejects.toBe('nope');

    expect(toast.error).toHaveBeenCalledWith('Failed to release escrow');
  });
});
