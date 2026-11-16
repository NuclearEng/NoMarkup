// useFollows — non-API failure toast, cache refresh on toggle, the page
// param on /me/follows, the `enabled` guard on followers, and the feed's
// `photos: null` normalization.
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFollow, useFollowers, useMyFeed, useMyFollows } from '@/hooks/useFollows';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  post: vi.fn<(path: string) => Promise<unknown>>(),
  delete: vi.fn<(path: string) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: mocks.get, post: mocks.post, delete: mocks.delete } };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { toast } = await import('sonner');

let h: QueryHarness;

beforeEach(() => {
  vi.clearAllMocks();
  h = createQueryHarness();
});

afterEach(() => {
  h.queryClient.clear();
});

describe('useFollow', () => {
  it('toasts the fixed fallback when the failure is not an ApiError', async () => {
    mocks.post.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useFollow('seller-1'), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ following: true })).rejects.toThrow('Failed to fetch');

    expect(toast.error).toHaveBeenCalledWith('Failed to update follow status');
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.invalidatedKeys()).toEqual([]);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it.each([
    { following: true, message: "Following — you'll see new auctions in your feed" },
    { following: false, message: 'Unfollowed' },
  ])('following=$following refreshes follows, that seller’s followers, and the feed', async ({ following, message }) => {
    mocks.post.mockResolvedValue({ following: true });
    mocks.delete.mockResolvedValue({ following: false });
    const { result } = renderHook(() => useFollow('seller-1'), { wrapper: h.wrapper });

    await result.current.mutateAsync({ following });

    expect(toast.success).toHaveBeenCalledWith(message);
    expect(h.invalidatedKeys()).toEqual([['follows'], ['followers', 'seller-1'], ['feed']]);
  });
});

describe('useFollowers', () => {
  it('does not fetch without a seller id', () => {
    const { result } = renderHook(() => useFollowers(''), { wrapper: h.wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('useMyFollows', () => {
  it('threads the page through the URL and the cache key', async () => {
    const response = { follows: [], pagination: { page: 3 } };
    mocks.get.mockResolvedValue(response);

    const { result } = renderHook(() => useMyFollows(3), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/me/follows?page=3');
    expect(h.queryClient.getQueryData(['follows', 3])).toEqual(response);
  });

  it('caches the un-paged request as page 1', async () => {
    mocks.get.mockResolvedValue({ follows: [] });

    const { result } = renderHook(() => useMyFollows(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/me/follows');
    expect(h.queryClient.getQueryData(['follows', 1])).toEqual({ follows: [] });
  });
});

describe('useMyFeed', () => {
  it('turns `photos: null` into an empty array and leaves real photos and other fields alone', async () => {
    const photo = { id: 'p-1', url: 'https://cdn.example/p-1.webp' };
    mocks.get.mockResolvedValue({
      listings: [
        { id: 'l-1', title: 'No photos', photos: null },
        { id: 'l-2', title: 'One photo', photos: [photo] },
      ],
      pagination: { page: 1, total_count: 2 },
    });

    const { result } = renderHook(() => useMyFeed(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({
      listings: [
        { id: 'l-1', title: 'No photos', photos: [] },
        { id: 'l-2', title: 'One photo', photos: [photo] },
      ],
      pagination: { page: 1, total_count: 2 },
    });
  });

  it('returns an empty feed unchanged', async () => {
    mocks.get.mockResolvedValue({ listings: [], pagination: { page: 1, total_count: 0 } });

    const { result } = renderHook(() => useMyFeed(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.listings).toEqual([]);
  });
});
