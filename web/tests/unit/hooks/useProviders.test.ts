import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePublicProviderProfile, useSearchProviders } from '@/hooks/useProviders';

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

describe('useSearchProviders', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('uses api.getPublic (skips auth retry on 401 — public endpoint)', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      providers: [],
      pagination: { page: 1, page_size: 20, total_count: 0, total_pages: 0 },
    });
    const { result } = renderHook(() => useSearchProviders({}), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/providers/search');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('encodes every filter into the query string', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      providers: [],
      pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 },
    });
    const { result } = renderHook(
      () => useSearchProviders({
        query: 'plumbing',
        category_id: 'cat-1',
        min_rating: 4,
        trust_tier: 'gold',
        verified: true,
        page: 2,
        page_size: 10,
      }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    const calledWith = vi.mocked(api.getPublic).mock.calls[0]![0];
    expect(calledWith).toContain('query=plumbing');
    expect(calledWith).toContain('category_id=cat-1');
    expect(calledWith).toContain('min_rating=4');
    expect(calledWith).toContain('trust_tier=gold');
    expect(calledWith).toContain('verified=true');
    expect(calledWith).toContain('page=2');
    expect(calledWith).toContain('page_size=10');
  });

  it('verified=false is encoded (not dropped as falsy)', async () => {
    // Critical: verified is a 3-state filter (undefined = no filter, false =
    // "only unverified providers"). Falsy-checking would corrupt the query.
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      providers: [],
      pagination: { page: 1, page_size: 20, total_count: 0, total_pages: 0 },
    });
    const { result } = renderHook(
      () => useSearchProviders({ verified: false }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.getPublic).mock.calls[0]![0]).toContain('verified=false');
  });
});

describe('usePublicProviderProfile', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches via getPublic (no auth required for public profile)', async () => {
    vi.mocked(api.getPublic).mockResolvedValueOnce({
      id: 'prov-1',
      user_id: 'u-1',
      display_name: 'Acme HVAC',
      business_name: 'Acme HVAC LLC',
      avatar_url: null,
      bio: 'best in town',
      service_categories: [],
      trust_score: null,
      review_summary: null,
      jobs_completed: 12,
      member_since: '2024-01-01',
      verified: true,
    });
    const { result } = renderHook(() => usePublicProviderProfile('prov-1'), {
      wrapper: wrap(client),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data?.display_name).toBe('Acme HVAC');
    expect(vi.mocked(api.getPublic)).toHaveBeenCalledWith('/api/v1/providers/prov-1');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => usePublicProviderProfile(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
