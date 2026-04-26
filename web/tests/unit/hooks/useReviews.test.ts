import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCreateReview,
  useFlagReview,
  useRespondToReview,
  useReview,
  useReviewEligibility,
  useReviewsForUser,
} from '@/hooks/useReviews';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) { return this.message || fallback; }
  },
}));
const { api } = await import('@/lib/api');

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

describe('useReviewEligibility', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches eligibility for a contract', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ eligible: true, reason: '' });
    const { result } = renderHook(() => useReviewEligibility('c-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data?.eligible).toBe(true);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/contracts/c-1/reviews/eligibility');
  });

  it('does not fetch with empty id', () => {
    const { result } = renderHook(() => useReviewEligibility(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateReview', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts review + invalidates eligibility/contract/reviews caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'r-1', overall_rating: 5 });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateReview(), { wrapper: wrap(client) });
    result.current.mutate({
      contractId: 'c-1',
      input: { overall_rating: 5, comment: 'great' },
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/reviews',
      { overall_rating: 5, comment: 'great' },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviewEligibility', 'c-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['contract', 'c-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews'] });
  });
});

describe('useReview', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches a single review by id', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ id: 'r-1', overall_rating: 4 });
    const { result } = renderHook(() => useReview('r-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data?.id).toBe('r-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/reviews/r-1');
  });

  it('does not fetch with empty id', () => {
    const { result } = renderHook(() => useReview(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useReviewsForUser', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches with no params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ reviews: [], total: 0 });
    const { result } = renderHook(() => useReviewsForUser('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/users/u-1/reviews');
  });

  it('appends direction + pagination', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ reviews: [], total: 0 });
    const { result } = renderHook(
      () => useReviewsForUser('u-1', { direction: 'received', page: 2, per_page: 25 }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/users/u-1/reviews?direction=received&page=2&per_page=25',
    );
  });

  it('does not fetch with empty userId', () => {
    const { result } = renderHook(() => useReviewsForUser(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRespondToReview + useFlagReview', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts response + invalidates reviews', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useRespondToReview(), { wrapper: wrap(client) });
    result.current.mutate({ reviewId: 'r-1', comment: 'thx' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/reviews/r-1/respond',
      { comment: 'thx' },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews'] });
  });

  it('flags a review with a reason', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ flag_id: 'f-1' });
    const { result } = renderHook(() => useFlagReview(), { wrapper: wrap(client) });
    result.current.mutate({ reviewId: 'r-1', reason: 'fake' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/reviews/r-1/flag',
      { reason: 'fake' },
    );
    expect(result.current.data?.flag_id).toBe('f-1');
  });
});
