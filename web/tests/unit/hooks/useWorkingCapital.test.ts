import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAdminAdvances,
  useCreditLimit,
  useDisburseAdvance,
  useMyAdvances,
  useRequestAdvance,
  useReviewAdvance,
} from '@/hooks/useWorkingCapital';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public body: string) {
      super(`API ${String(status)}: ${body}`);
      this.name = 'ApiError';
    }
  }
  return {
    api: {
      get: vi.fn(),
      getPublic: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    ApiError,
  };
});

const { api, ApiError: FakeApiError } = await import('@/lib/api');

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

describe('useMyAdvances', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the provider advances list', async () => {
    const response = { advances: [], pagination: { total_count: 0 } };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useMyAdvances(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data).toEqual(response);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/advances');
  });

  it('returns null on 404 (provider has no advances yet)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(404, 'no advances'));
    const { result } = renderHook(() => useMyAdvances(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('returns null on 500 (graceful degrade)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(500, 'down'));
    const { result } = renderHook(() => useMyAdvances(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404/500 errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(403, 'forbidden'));
    const { result } = renderHook(() => useMyAdvances(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });
});

describe('useCreditLimit', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the provider credit limit', async () => {
    const response = { limit_cents: 500_000, available_cents: 250_000 };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useCreditLimit(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data).toEqual(response);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/credit-limit');
  });
});

describe('useRequestAdvance', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts the advance request, unwraps advance, invalidates my-advances + credit-limit', async () => {
    const advance = { id: 'adv-1', status: 'pending' };
    vi.mocked(api.post).mockResolvedValueOnce({ advance });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useRequestAdvance(), { wrapper: wrap(client) });
    result.current.mutate({ contract_id: 'c-1', advance_amount_cents: 50_000 });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/providers/me/advances',
      { contract_id: 'c-1', amount_cents: 50_000 },
    );
    expect(result.current.data).toEqual(advance);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-advances'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['credit-limit'] });
  });

  it('shows an error toast when the advance request fails', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValueOnce(new FakeApiError(400, 'limit exceeded'));

    const { result } = renderHook(() => useRequestAdvance(), { wrapper: wrap(client) });
    result.current.mutate({ contract_id: 'c-1', advance_amount_cents: 999_999_999 });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(toast.error).toHaveBeenCalledWith('Failed to request advance');
  });
});

describe('useAdminAdvances', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches with no params (no query string)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ advances: [], pagination: { total_count: 0 } });
    const { result } = renderHook(() => useAdminAdvances(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/advances');
  });

  it('appends status + pagination params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ advances: [], pagination: { total_count: 0 } });
    const { result } = renderHook(
      () => useAdminAdvances({ status: 'pending', page: 2, page_size: 25 }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/admin/advances?status=pending&page=2&page_size=25',
    );
  });
});

describe('useReviewAdvance', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts review action with reason, invalidates admin-advances', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ advance: { id: 'adv-1', status: 'approved' } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useReviewAdvance(), { wrapper: wrap(client) });
    result.current.mutate({ advanceId: 'adv-1', action: 'approve', reason: 'looks good' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/admin/advances/adv-1/review',
      { action: 'approve', reason: 'looks good' },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['admin-advances'] });
  });

  it('shows an error toast when the review request fails', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValueOnce(new FakeApiError(500, 'boom'));

    const { result } = renderHook(() => useReviewAdvance(), { wrapper: wrap(client) });
    result.current.mutate({ advanceId: 'adv-1', action: 'reject' });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(toast.error).toHaveBeenCalledWith('Failed to review advance');
  });
});

describe('useDisburseAdvance', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts to disburse, unwraps advance, invalidates admin-advances', async () => {
    const advance = { id: 'adv-1', status: 'disbursed' };
    vi.mocked(api.post).mockResolvedValueOnce({ advance });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDisburseAdvance(), { wrapper: wrap(client) });
    result.current.mutate('adv-1');
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/admin/advances/adv-1/disburse');
    expect(result.current.data).toEqual(advance);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['admin-advances'] });
  });

  it('shows an error toast when the disburse request fails', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValueOnce(new FakeApiError(500, 'down'));

    const { result } = renderHook(() => useDisburseAdvance(), { wrapper: wrap(client) });
    result.current.mutate('adv-1');

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(toast.error).toHaveBeenCalledWith('Failed to disburse advance');
  });
});
