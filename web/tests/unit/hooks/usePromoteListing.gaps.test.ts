// usePromoteListing — success side effects (key cleared, caches refreshed,
// toast) and both failure toasts for each of the two promotion mutations.
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConfirmPromotion, useCreatePromotion } from '@/hooks/usePromoteListing';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  post: vi.fn<(path: string, body?: unknown, headers?: Record<string, string>) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { post: mocks.post } };
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

describe('useCreatePromotion', () => {
  it('does not toast or invalidate on success (nothing is promoted until confirm)', async () => {
    mocks.post.mockResolvedValue({ charge_id: 'ch-1', client_secret: 'seti_secret' });
    const { result } = renderHook(() => useCreatePromotion('l-1'), { wrapper: h.wrapper });

    await result.current.mutateAsync({ duration_hours: 24 });

    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1/listings/l-1/promote',
      { duration_hours: 24 },
      { 'Idempotency-Key': expect.any(String) as string },
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.invalidatedKeys()).toEqual([]);
  });

  it('reuses the key when a failed start is retried, mints a new one after success, and keys by duration', async () => {
    mocks.post
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ charge_id: 'ch-1', client_secret: 'seti_secret' });
    const { result } = renderHook(() => useCreatePromotion('l-1'), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ duration_hours: 24 })).rejects.toThrow('offline');
    await result.current.mutateAsync({ duration_hours: 24 });
    await result.current.mutateAsync({ duration_hours: 24 });
    await result.current.mutateAsync({ duration_hours: 72 });

    const [first, retry, afterSuccess, otherDuration] = sentKeys();
    expect(first).toEqual(expect.any(String));
    expect(retry).toBe(first);
    expect(afterSuccess).not.toBe(first);
    expect(otherDuration).not.toBe(afterSuccess);
  });

  it('toasts the gateway reason for an ApiError', async () => {
    mocks.post.mockRejectedValue(new ApiError(409, '{"error":"listing already promoted"}'));
    const { result } = renderHook(() => useCreatePromotion('l-1'), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ duration_hours: 24 })).rejects.toBeInstanceOf(ApiError);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('listing already promoted');
  });

  it('toasts the fixed fallback for any other failure', async () => {
    mocks.post.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useCreatePromotion('l-1'), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ duration_hours: 24 })).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith('Could not start promotion');
  });
});

describe('useConfirmPromotion', () => {
  it('refreshes the listing, marketplace and my-listings caches, then toasts', async () => {
    mocks.post.mockResolvedValue({ promoted_until: '2026-02-01T00:00:00Z' });
    const { result } = renderHook(() => useConfirmPromotion('l-1'), { wrapper: h.wrapper });

    await result.current.mutateAsync({ charge_id: 'ch-1' });

    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1/listings/l-1/promote/confirm',
      { charge_id: 'ch-1' },
      { 'Idempotency-Key': expect.any(String) as string },
    );
    expect(h.invalidatedKeys()).toEqual([['listing', 'l-1'], ['listings'], ['my-listings']]);
    expect(toast.success).toHaveBeenCalledWith('Listing promoted');
  });

  it('keeps the key across a failed confirm and replaces it after a successful one', async () => {
    mocks.post
      .mockRejectedValueOnce(new ApiError(502, ''))
      .mockResolvedValue({ promoted_until: '2026-02-01T00:00:00Z' });
    const { result } = renderHook(() => useConfirmPromotion('l-1'), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ charge_id: 'ch-1' })).rejects.toBeInstanceOf(ApiError);
    await result.current.mutateAsync({ charge_id: 'ch-1' });
    await result.current.mutateAsync({ charge_id: 'ch-1' });

    const [first, retry, afterSuccess] = sentKeys();
    expect(retry).toBe(first);
    expect(afterSuccess).not.toBe(first);
  });

  it('toasts the gateway reason for an ApiError and leaves caches alone', async () => {
    mocks.post.mockRejectedValue(new ApiError(402, '{"error":"card declined"}'));
    const { result } = renderHook(() => useConfirmPromotion('l-1'), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ charge_id: 'ch-1' })).rejects.toBeInstanceOf(ApiError);

    expect(toast.error).toHaveBeenCalledWith('card declined');
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.invalidatedKeys()).toEqual([]);
  });

  it('toasts the fixed fallback for any other failure', async () => {
    mocks.post.mockRejectedValue(new Error('socket hang up'));
    const { result } = renderHook(() => useConfirmPromotion('l-1'), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ charge_id: 'ch-1' })).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith('Could not finalize promotion');
  });
});
