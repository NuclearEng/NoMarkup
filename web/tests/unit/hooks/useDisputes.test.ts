import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDispute, useFileDispute } from '@/hooks/useDisputes';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) { return this.message || fallback; }
  },
  getApiErrorMessage: (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback,
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

describe('useFileDispute', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts the dispute payload and invalidates disputes cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ dispute_id: 'd-1', status: 'open' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useFileDispute(), { wrapper: wrap(client) });
    const input = {
      contract_id: 'c-1',
      reason: 'incomplete',
      description: 'work was not finished',
      evidence_urls: ['https://s3/photo.png'],
    };
    result.current.mutate(input);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/disputes', input);
    expect(result.current.data?.dispute_id).toBe('d-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['disputes'] });
  });

  it('shows toast.error on file failure (covers onError)', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useFileDispute(), { wrapper: wrap(client) });
    result.current.mutate({
      contract_id: 'c-1',
      reason: 'incomplete',
      description: 'work was not finished',
      evidence_urls: [],
    });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      // getApiErrorMessage surfaces the Error reason; the literal stays as the fallback.
      'boom',
    );
  });
});

describe('useDispute', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches a single dispute by id', async () => {
    const dispute = {
      dispute_id: 'd-1',
      contract_id: 'c-1',
      reason: 'incomplete',
      description: 'unfinished',
      evidence_urls: [] as string[],
      created_by: 'u-1',
      status: 'open',
      created_at: '2026-04-25T00:00:00Z',
    };
    vi.mocked(api.get).mockResolvedValueOnce({ dispute });

    const { result } = renderHook(() => useDispute('d-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.dispute.dispute_id).toBe('d-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/disputes/d-1');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useDispute(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});
