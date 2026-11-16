// useOffers — everything beyond the single idempotency test in
// useOffers.test.ts: the listing query, creating an offer, the per-action
// toasts, failure toasts (ApiError vs anything else), sticky idempotency keys
// on failure, and the counter-chain depth helpers.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type OfferAction,
  awaitingPartyForDepth,
  computeOfferDepths,
  useCreateOffer,
  useListingOffers,
  useUpdateOffer,
} from '@/hooks/useOffers';
import type { Offer } from '@/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  patch:
    vi.fn<(path: string, body?: unknown, headers?: Record<string, string>) => Promise<unknown>>(),
}));

// Real ApiError + real idempotency key store; only the transport is stubbed.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: mocks.get, post: mocks.post, patch: mocks.patch } };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { ApiError, __resetIdempotencyKeysForTests } = await import('@/lib/api');
const { toast } = await import('sonner');

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

let invalidatedKeys: () => unknown[];

function offer(id: string, parent: string | null = null): Offer {
  return {
    id,
    listing_id: 'l-1',
    buyer_id: 'buyer-1',
    amount_cents: 1000,
    status: 'pending',
    parent_offer_id: parent,
    expires_at: '2026-01-02T00:00:00Z',
    message: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetIdempotencyKeysForTests();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  invalidatedKeys = () => invalidate.mock.calls.map((call) => call[0]?.queryKey);
});

afterEach(() => {
  queryClient.clear();
});

describe('useListingOffers', () => {
  it('fetches the listing offers under ["offers", "listing", id]', async () => {
    const response = { offers: [offer('o-1')] };
    mocks.get.mockResolvedValue(response);

    const { result } = renderHook(() => useListingOffers('l-1'), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/listings/l-1/offers');
    expect(queryClient.getQueryData(['offers', 'listing', 'l-1'])).toEqual(response);
  });

  it('does not fetch without a listing id', () => {
    const { result } = renderHook(() => useListingOffers(''), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('useCreateOffer', () => {
  it('sends an empty message when none is given, then toasts and refreshes offers + listing', async () => {
    mocks.post.mockResolvedValue({ offer: offer('o-1') });
    const { result } = renderHook(() => useCreateOffer('l-1'), { wrapper });

    await result.current.mutateAsync({ amount_cents: 4200 });

    expect(mocks.post).toHaveBeenCalledWith('/api/v1/listings/l-1/offers', {
      amount_cents: 4200,
      message: '',
    });
    expect(toast.success).toHaveBeenCalledWith('Offer sent — the seller has 24 hours to respond');
    expect(invalidatedKeys()).toEqual([
      ['offers', 'listing', 'l-1'],
      ['listings', 'l-1'],
    ]);
  });

  it('passes the buyer message through', async () => {
    mocks.post.mockResolvedValue({ offer: offer('o-1') });
    const { result } = renderHook(() => useCreateOffer('l-1'), { wrapper });

    await result.current.mutateAsync({ amount_cents: 4200, message: 'Can pick up today' });

    expect(mocks.post).toHaveBeenCalledWith('/api/v1/listings/l-1/offers', {
      amount_cents: 4200,
      message: 'Can pick up today',
    });
  });

  it('toasts the gateway reason for an ApiError and invalidates nothing', async () => {
    mocks.post.mockRejectedValue(new ApiError(409, '{"error":"listing is not active"}'));
    const { result } = renderHook(() => useCreateOffer('l-1'), { wrapper });

    await expect(result.current.mutateAsync({ amount_cents: 1 })).rejects.toBeInstanceOf(ApiError);

    expect(toast.error).toHaveBeenCalledWith('listing is not active');
    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidatedKeys()).toEqual([]);
  });

  it('toasts the fallback for a non-API failure (never the raw error text)', async () => {
    mocks.post.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useCreateOffer('l-1'), { wrapper });

    await expect(result.current.mutateAsync({ amount_cents: 1 })).rejects.toThrow('Failed to fetch');

    expect(toast.error).toHaveBeenCalledWith('Failed to send offer');
  });
});

describe('useUpdateOffer', () => {
  const toastCases: { action: OfferAction; message: string }[] = [
    { action: 'accept', message: 'Offer accepted — order created' },
    { action: 'reject', message: 'Offer rejected' },
    { action: 'counter', message: 'Counter-offer sent' },
    { action: 'withdraw', message: 'Offer withdrawn' },
  ];

  it.each(toastCases)('$action → "$message", defaults filled in, caches refreshed', async ({ action, message }) => {
    mocks.patch.mockResolvedValue({ offer: offer('o-1') });
    const { result } = renderHook(() => useUpdateOffer('l-1'), { wrapper });

    await result.current.mutateAsync({ offerId: 'o-1', action });

    expect(mocks.patch).toHaveBeenCalledWith(
      '/api/v1/offers/o-1',
      { action, counter_amount_cents: 0, message: '' },
      { 'Idempotency-Key': expect.any(String) as string },
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(message);
    expect(invalidatedKeys()).toEqual([
      ['offers', 'listing', 'l-1'],
      ['listings', 'l-1'],
    ]);
  });

  it('sends the counter amount and message for a counter-offer', async () => {
    mocks.patch.mockResolvedValue({ offer: offer('o-2', 'o-1') });
    const { result } = renderHook(() => useUpdateOffer('l-1'), { wrapper });

    await result.current.mutateAsync({
      offerId: 'o-1',
      action: 'counter',
      counter_amount_cents: 5500,
      message: 'Meet in the middle?',
    });

    expect(mocks.patch.mock.calls[0]?.[1]).toEqual({
      action: 'counter',
      counter_amount_cents: 5500,
      message: 'Meet in the middle?',
    });
  });

  it('keeps the same Idempotency-Key for a retry after failure, and mints a new one after success', async () => {
    mocks.patch
      .mockRejectedValueOnce(new ApiError(502, ''))
      .mockResolvedValueOnce({ offer: offer('o-1') })
      .mockResolvedValueOnce({ offer: offer('o-1') });
    const { result } = renderHook(() => useUpdateOffer('l-1'), { wrapper });
    const input = { offerId: 'o-1', action: 'accept' } as const;

    await expect(result.current.mutateAsync(input)).rejects.toBeInstanceOf(ApiError);
    await result.current.mutateAsync(input);
    await result.current.mutateAsync(input);

    const keys = mocks.patch.mock.calls.map((call) => call[2]?.['Idempotency-Key']);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    // Empty body + no JSON: ApiError.userMessage falls back to the hook copy.
    expect(toast.error).toHaveBeenCalledWith('Failed to update offer');
  });

  it('uses a different key per action on the same offer', async () => {
    mocks.patch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useUpdateOffer('l-1'), { wrapper });

    await expect(result.current.mutateAsync({ offerId: 'o-1', action: 'accept' })).rejects.toThrow();
    await expect(result.current.mutateAsync({ offerId: 'o-1', action: 'reject' })).rejects.toThrow();

    const keys = mocks.patch.mock.calls.map((call) => call[2]?.['Idempotency-Key']);
    expect(keys[0]).not.toBe(keys[1]);
    expect(toast.error).toHaveBeenCalledWith('Failed to update offer');
    expect(invalidatedKeys()).toEqual([]);
  });
});

describe('computeOfferDepths', () => {
  it('returns an empty map for no offers', () => {
    expect(computeOfferDepths([]).size).toBe(0);
  });

  it('walks parents to number a counter chain, whatever order the rows arrive in', () => {
    const depths = computeOfferDepths([
      offer('c', 'b'),
      offer('a'),
      offer('b', 'a'),
      offer('d', 'c'),
    ]);
    expect(Object.fromEntries(depths)).toEqual({ a: 0, b: 1, c: 2, d: 3 });
  });

  it('numbers sibling counters off the same parent independently', () => {
    const depths = computeOfferDepths([offer('root'), offer('x', 'root'), offer('y', 'root')]);
    expect(Object.fromEntries(depths)).toEqual({ root: 0, x: 1, y: 1 });
  });

  it('treats an offer whose parent is not in the set as depth 0', () => {
    const depths = computeOfferDepths([offer('orphan', 'missing'), offer('child', 'orphan')]);
    expect(Object.fromEntries(depths)).toEqual({ orphan: 0, child: 1 });
  });

  it('terminates on a parent cycle instead of recursing forever', () => {
    const depths = computeOfferDepths([offer('a', 'b'), offer('b', 'a'), offer('self', 'self')]);
    // The `seen` guard cuts the loop; every offer still gets a finite depth.
    expect([...depths.keys()].sort()).toEqual(['a', 'b', 'self']);
    for (const depth of depths.values()) {
      expect(Number.isInteger(depth)).toBe(true);
      expect(depth).toBeLessThanOrEqual(2);
    }
  });
});

describe('awaitingPartyForDepth', () => {
  it.each([
    [0, 'seller'],
    [1, 'buyer'],
    [2, 'seller'],
    [3, 'buyer'],
  ] as const)('depth %d awaits the %s', (depth, party) => {
    expect(awaitingPartyForDepth(depth)).toBe(party);
  });
});
