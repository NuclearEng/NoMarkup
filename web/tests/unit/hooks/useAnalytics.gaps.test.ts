// useAnalytics — `useFairPrice` (untested in useAnalytics.test.ts) and the
// signed-out guard on the provider analytics / earnings queries.
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type UseFairPriceArgs,
  useCustomerSpending,
  useFairPrice,
  useProviderAnalytics,
  useProviderEarnings,
} from '@/hooks/useAnalytics';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  getPublic: vi.fn<(path: string) => Promise<unknown>>(),
  user: { current: null as { id: string } | null },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: mocks.get, getPublic: mocks.getPublic } };
});

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: mocks.user.current }),
}));

const { ApiError } = await import('@/lib/api');

let h: QueryHarness;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.current = null;
  h = createQueryHarness();
});

afterEach(() => {
  h.queryClient.clear();
});

describe('useFairPrice — request shape', () => {
  const cases: { name: string; args: UseFairPriceArgs; url: string }[] = [
    {
      name: 'category id',
      args: { categoryId: 'cat-1' },
      url: '/api/v1/analytics/fair-price?category_id=cat-1',
    },
    {
      name: 'category slug when there is no id',
      args: { categorySlug: 'plumbing' },
      url: '/api/v1/analytics/fair-price?category_slug=plumbing',
    },
    {
      name: 'id wins over slug (slug is not sent)',
      args: { categoryId: 'cat-1', categorySlug: 'plumbing' },
      url: '/api/v1/analytics/fair-price?category_id=cat-1',
    },
    {
      name: 'zip appended',
      args: { categorySlug: 'plumbing', zip: '94107' },
      url: '/api/v1/analytics/fair-price?category_slug=plumbing&zip=94107',
    },
  ];

  it.each(cases)('$name', async ({ args, url }) => {
    const price = { has_data: true, median_cents: 12_000 };
    mocks.getPublic.mockResolvedValue(price);

    const { result } = renderHook(() => useFairPrice(args), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mocks.getPublic).toHaveBeenCalledWith(url);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(
      h.queryClient.getQueryData(['fair-price', args.categoryId, args.categorySlug, args.zip]),
    ).toEqual(price);
  });

  it.each<{ name: string; args: UseFairPriceArgs }>([
    { name: 'no category at all', args: {} },
    { name: 'only a zip', args: { zip: '94107' } },
    { name: 'empty id and slug', args: { categoryId: '', categorySlug: '' } },
  ])('does not fetch with $name', ({ args }) => {
    const { result } = renderHook(() => useFairPrice(args), { wrapper: h.wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.getPublic).not.toHaveBeenCalled();
  });

  it('does not fetch when the id is an empty string even though a slug is present', () => {
    // `categoryId ?? categorySlug` only falls through on null/undefined.
    const { result } = renderHook(
      () => useFairPrice({ categoryId: '', categorySlug: 'plumbing' }),
      { wrapper: h.wrapper },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.getPublic).not.toHaveBeenCalled();
  });
});

describe('useFairPrice — error handling', () => {
  it.each([404, 401])('maps a %d to the no-data empty state', async (status) => {
    mocks.getPublic.mockRejectedValue(new ApiError(status, 'nope'));

    const { result } = renderHook(() => useFairPrice({ categoryId: 'cat-1' }), {
      wrapper: h.wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({ has_data: false });
  });

  it('surfaces a 500 as an error without retrying', async () => {
    mocks.getPublic.mockRejectedValue(new ApiError(500, 'boom'));

    const { result } = renderHook(() => useFairPrice({ categoryId: 'cat-1' }), {
      wrapper: h.wrapper,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(mocks.getPublic).toHaveBeenCalledTimes(1);
  });

  it('surfaces a network failure (not an ApiError) as an error', async () => {
    mocks.getPublic.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useFairPrice({ categoryId: 'cat-1' }), {
      wrapper: h.wrapper,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(TypeError);
  });
});

describe('provider analytics — signed-out guard', () => {
  it('useProviderAnalytics does not fetch until a user id is known, then uses that id', async () => {
    mocks.get.mockResolvedValue({ jobs_won: 3 });
    const { result, rerender } = renderHook(() => useProviderAnalytics('2026-01-01'), {
      wrapper: h.wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();

    mocks.user.current = { id: 'user-7' };
    rerender();

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/analytics/providers/user-7?start_date=2026-01-01');
  });

  it('useProviderEarnings does not fetch while signed out', () => {
    const { result } = renderHook(() => useProviderEarnings(undefined, undefined, 'month'), {
      wrapper: h.wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('useProviderEarnings rethrows a non-API failure', async () => {
    mocks.user.current = { id: 'user-7' };
    mocks.get.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useProviderEarnings(), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/analytics/providers/user-7/earnings');
  });
});

describe('useCustomerSpending — property scope guard', () => {
  it('waits while the property scope is an empty string, and caches unscoped spending under a null property', async () => {
    const scoped = renderHook(() => useCustomerSpending(undefined, undefined, undefined, ''), {
      wrapper: h.wrapper,
    });
    expect(scoped.result.current.fetchStatus).toBe('idle');
    expect(mocks.get).not.toHaveBeenCalled();

    mocks.get.mockResolvedValue({ total_cents: 0 });
    const unscoped = renderHook(() => useCustomerSpending(), { wrapper: h.wrapper });
    await waitFor(() => {
      expect(unscoped.result.current.isSuccess).toBe(true);
    });
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/analytics/customers/me/spending');
    expect(
      h.queryClient.getQueryData(['customer-spending', undefined, undefined, undefined, null]),
    ).toEqual({ total_cents: 0 });
  });
});
