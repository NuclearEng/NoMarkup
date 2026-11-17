// useSubscription — non-API failure toasts for the three mutations, the
// "no toast for an inactive subscription" path, sticky idempotency keys, and
// the confirmation-secret helpers.
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  changeTierConfirmationSecret,
  subscriptionConfirmationSecret,
  useCancelSubscription,
  useChangeTier,
  useCreateSubscription,
} from '@/hooks/useSubscription';
import type { ChangeTierResult, CreateSubscriptionResult, Subscription } from '@/types';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  post: vi.fn<(path: string, body?: unknown, headers?: Record<string, string>) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn(), post: mocks.post } };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { ApiError, __resetIdempotencyKeysForTests } = await import('@/lib/api');
const { toast } = await import('sonner');

function subscription(status: Subscription['status']): Subscription {
  return {
    id: 'sub-1',
    user_id: 'u-1',
    tier_id: 'pro',
    tier: {} as Subscription['tier'],
    status,
    billing_interval: 'monthly',
    current_price_cents: 2900,
    current_period_start: '2026-01-01T00:00:00Z',
    current_period_end: '2026-02-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  };
}

const createInput = { tier_id: 'pro', billing_interval: 'monthly', payment_method_id: 'pm_1' } as const;

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

describe('failure toasts', () => {
  it('create: fixed fallback for a non-API failure, and the retry reuses the Idempotency-Key', async () => {
    mocks.post.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useCreateSubscription(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync(createInput)).rejects.toThrow();
    await expect(result.current.mutateAsync(createInput)).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith('Failed to start subscription');
    const [first, retry] = sentKeys();
    expect(first).toEqual(expect.any(String));
    expect(retry).toBe(first);
    expect(h.invalidatedKeys()).toEqual([]);
  });

  it('create: gateway reason for an ApiError', async () => {
    mocks.post.mockRejectedValue(new ApiError(402, '{"error":"Your card was declined"}'));
    const { result } = renderHook(() => useCreateSubscription(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync(createInput)).rejects.toBeInstanceOf(ApiError);

    expect(toast.error).toHaveBeenCalledWith('Your card was declined');
  });

  it('cancel and change tier: gateway reason for an ApiError', async () => {
    mocks.post
      .mockRejectedValueOnce(new ApiError(409, '{"error":"subscription already cancelled"}'))
      .mockRejectedValueOnce(new ApiError(409, '{"error":"already on this plan"}'));
    const cancel = renderHook(() => useCancelSubscription(), { wrapper: h.wrapper });
    const change = renderHook(() => useChangeTier(), { wrapper: h.wrapper });

    await expect(
      cancel.result.current.mutateAsync({ reason: 'other', cancel_immediately: true }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      change.result.current.mutateAsync({ new_tier_id: 'pro', billing_interval: 'annual' }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual([
      'subscription already cancelled',
      'already on this plan',
    ]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.invalidatedKeys()).toEqual([]);
  });

  it('cancel: fixed fallback for a non-API failure', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCancelSubscription(), { wrapper: h.wrapper });

    await expect(
      result.current.mutateAsync({ reason: 'too_expensive', cancel_immediately: false }),
    ).rejects.toThrow();

    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1/subscriptions/cancel',
      { reason: 'too_expensive', cancel_immediately: false },
      { 'Idempotency-Key': expect.any(String) as string },
    );
    expect(toast.error).toHaveBeenCalledWith('Failed to cancel subscription');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('change tier: fixed fallback for a non-API failure', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useChangeTier(), { wrapper: h.wrapper });

    await expect(
      result.current.mutateAsync({ new_tier_id: 'business', billing_interval: 'monthly' }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith('Failed to change plan');
    expect(h.invalidatedKeys()).toEqual([]);
  });
});

describe('useCreateSubscription — success without an active plan', () => {
  it.each(['incomplete', 'past_due'] as const)(
    'status %s: refreshes caches but does not announce "Subscription started"',
    async (status) => {
      mocks.post.mockResolvedValue({ subscription: subscription(status) });
      const { result } = renderHook(() => useCreateSubscription(), { wrapper: h.wrapper });

      await result.current.mutateAsync(createInput);

      expect(toast.success).not.toHaveBeenCalled();
      expect(h.invalidatedKeys()).toEqual([['subscription'], ['subscription-usage']]);
    },
  );

  it('a trialing subscription with no client_secret is announced', async () => {
    mocks.post.mockResolvedValue({ subscription: subscription('trialing') });
    const { result } = renderHook(() => useCreateSubscription(), { wrapper: h.wrapper });

    await result.current.mutateAsync(createInput);

    expect(toast.success).toHaveBeenCalledWith('Subscription started');
  });

  it('mints a fresh Idempotency-Key for the next attempt after a success', async () => {
    mocks.post.mockResolvedValue({ subscription: subscription('active') });
    const { result } = renderHook(() => useCreateSubscription(), { wrapper: h.wrapper });

    await result.current.mutateAsync(createInput);
    await result.current.mutateAsync(createInput);

    const [first, second] = sentKeys();
    expect(second).not.toBe(first);
  });
});

describe('confirmation secret helpers', () => {
  const changeResult: ChangeTierResult = {
    subscription: subscription('active'),
    proration_amount_cents: 500,
    tier_applied: false,
  };

  it('returns "" when there is no response yet', () => {
    expect(changeTierConfirmationSecret(undefined)).toBe('');
    expect(subscriptionConfirmationSecret(undefined)).toBe('');
  });

  it('returns "" when the response carries no secret', () => {
    expect(changeTierConfirmationSecret(changeResult)).toBe('');
    expect(subscriptionConfirmationSecret({ subscription: subscription('active') })).toBe('');
  });

  it('returns the secret when present', () => {
    // Fabricated, built from parts so no secret scanner reads them as
    // credentials (docs/security/secret-scanning.md).
    const createdToken = ['pi', '123', 'secret', 'abc'].join('_');
    const changedToken = ['pi', '456', 'secret', 'def'].join('_');
    const created: CreateSubscriptionResult = {
      subscription: subscription('incomplete'),
      client_secret: createdToken,
    };
    expect(subscriptionConfirmationSecret(created)).toBe(createdToken);
    expect(
      changeTierConfirmationSecret({ ...changeResult, ...{ client_secret: changedToken } }),
    ).toBe(changedToken);
  });

  it('ignores a secret that is not a string', () => {
    expect(changeTierConfirmationSecret({ ...changeResult, ...{ client_secret: 12345 } })).toBe('');
    expect(changeTierConfirmationSecret({ ...changeResult, ...{ client_secret: null } })).toBe('');
  });
});
