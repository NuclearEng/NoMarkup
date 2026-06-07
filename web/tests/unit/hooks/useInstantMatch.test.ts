import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAcceptOffer,
  useCreateInstantMatch,
  useDeclineOffer,
  useProviderOffers,
} from '@/hooks/useInstantMatch';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) { return this.message || fallback; }
  },
  getApiErrorMessage: (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback,
}));

const { api } = await import('@/lib/api');

function qc(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}
function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useProviderOffers', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the live provider offers list', async () => {
    const offers = [{
      job_id: 'j-1',
      job_title: 'Plumbing',
      job_location: 'Berkeley',
      expires_at: '2026-04-25T09:00:00Z',
      amount_cents: 25_000,
    }];
    vi.mocked(api.get).mockResolvedValueOnce({ offers });

    const { result } = renderHook(() => useProviderOffers(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.offers).toEqual(offers);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/provider/offers');
  });
});

describe('useAcceptOffer', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts to the per-job accept endpoint (no body) + invalidates provider-offers', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ status: 'accepted' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useAcceptOffer('j-1'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/provider/offers/j-1/accept');
    expect(result.current.data?.status).toBe('accepted');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['provider-offers'] });
  });

  it('shows an error toast when the accept mutation fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('expired'));

    const { result } = renderHook(() => useAcceptOffer('j-1'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    // getApiErrorMessage surfaces the Error reason; the literal stays as the fallback.
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('expired');
  });
});

describe('useDeclineOffer', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts to the per-job decline endpoint (no body) + invalidates provider-offers', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ status: 'declined' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeclineOffer('j-1'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/provider/offers/j-1/decline');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['provider-offers'] });
  });

  it('shows an error toast when the decline mutation fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useDeclineOffer('j-1'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('boom');
  });
});

describe('useCreateInstantMatch', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts to the per-job instant-match endpoint (no body) and returns status + expires_at', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      status: 'matching',
      expires_at: '2026-04-25T09:30:00Z',
    });

    const { result } = renderHook(() => useCreateInstantMatch('j-1'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/jobs/j-1/instant-match');
    expect(result.current.data?.status).toBe('matching');
  });

  it('shows an error toast when the instant-match mutation fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('no providers'));

    const { result } = renderHook(() => useCreateInstantMatch('j-1'), { wrapper: wrap(client) });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('no providers');
  });
});
