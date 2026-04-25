import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAdminGuaranteeClaims,
  useGuaranteeClaim,
  useReviewGuaranteeClaim,
  useSubmitGuaranteeClaim,
} from '@/hooks/useGuarantee';

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

describe('useSubmitGuaranteeClaim', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts the claim to /contracts/:id/guarantee-claim and invalidates contract + claim caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'd-1', status: 'open' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSubmitGuaranteeClaim(), { wrapper: wrap(client) });
    result.current.mutate({
      contractId: 'c-1',
      reason: 'incomplete',
      description: 'work unfinished',
      evidence_urls: ['https://s3/photo.png'],
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/guarantee-claim',
      {
        reason: 'incomplete',
        description: 'work unfinished',
        evidence_urls: ['https://s3/photo.png'],
      },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['contract', 'c-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['guarantee-claim', 'c-1'] });
  });
});

describe('useGuaranteeClaim', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the claim for a contract', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ guarantee_claim: null });

    const { result } = renderHook(() => useGuaranteeClaim('c-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/contracts/c-1/guarantee-claim');
    expect(result.current.data?.guarantee_claim).toBeNull();
  });

  it('does not fetch when contractId is empty', () => {
    const { result } = renderHook(() => useGuaranteeClaim(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});

describe('useAdminGuaranteeClaims', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches with no params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      guarantee_claims: [],
      pagination: { total_count: 0 },
    });
    const { result } = renderHook(() => useAdminGuaranteeClaims(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/guarantee-claims');
  });

  it('appends status + pagination params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      guarantee_claims: [],
      pagination: { total_count: 0 },
    });
    const { result } = renderHook(
      () => useAdminGuaranteeClaims({ status: 'open', page: 2, page_size: 25 }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/admin/guarantee-claims?status=open&page=2&page_size=25',
    );
  });
});

describe('useReviewGuaranteeClaim', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('puts the review with payout_cents and invalidates admin claims', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ guarantee_claim: { id: 'd-1' } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useReviewGuaranteeClaim(), { wrapper: wrap(client) });
    result.current.mutate({
      claimId: 'd-1',
      approved: true,
      resolution_notes: 'approved',
      payout_cents: 50000,
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith(
      '/api/v1/admin/guarantee-claims/d-1/review',
      { approved: true, resolution_notes: 'approved', payout_cents: 50000 },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', 'guarantee-claims'] });
  });

  it('defaults payout_cents to 0 when omitted', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ guarantee_claim: { id: 'd-1' } });

    const { result } = renderHook(() => useReviewGuaranteeClaim(), { wrapper: wrap(client) });
    result.current.mutate({
      claimId: 'd-1',
      approved: false,
      resolution_notes: 'denied',
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith(
      '/api/v1/admin/guarantee-claims/d-1/review',
      { approved: false, resolution_notes: 'denied', payout_cents: 0 },
    );
  });
});
