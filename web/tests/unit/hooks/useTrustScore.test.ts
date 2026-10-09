import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTierRequirements, useTrustHistory, useTrustScore } from '@/hooks/useTrustScore';

// vi.mock factories are hoisted, so the ApiError class must be defined inline
// inside the factory (no top-level variable references). The hooks under test
// use `error instanceof ApiError` — they catch ANY thrown ApiError, not just
// the specific class identity, so any class named ApiError with the .status
// field works for the hook's narrowing.
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public body: string) {
      super(`API ${String(status)}: ${body}`);
      this.name = 'ApiError';
    }
  }
  return {
    api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    ApiError,
  };
});
const { api, ApiError: FakeApiError } = await import('@/lib/api');

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

describe('useTrustScore', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('wraps the unwrapped gateway response in { score }', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ overall_score: 85, tier: 'gold' });
    const { result } = renderHook(() => useTrustScore('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data?.score.overall_score).toBe(85);
  });

  it('returns null on 404 (no score yet for new providers)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(404, 'no score'));
    const { result } = renderHook(() => useTrustScore('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('returns null on 500 (graceful degrade — trust display is non-essential)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(500, 'svc down'));
    const { result } = renderHook(() => useTrustScore('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404/500 errors (so caller sees real auth/network bugs)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(403, 'forbidden'));
    const { result } = renderHook(() => useTrustScore('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });

  it('does not fetch with empty userId', () => {
    const { result } = renderHook(() => useTrustScore(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useTrustHistory', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('encodes pagination params into the query string', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ history: [], pagination: { total_count: 0 } });
    const { result } = renderHook(() => useTrustHistory('u-1', 2, 50), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/users/u-1/trust-history?page=2&page_size=50',
    );
  });

  it('omits empty params from the URL', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ history: [], pagination: { total_count: 0 } });
    const { result } = renderHook(() => useTrustHistory('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/users/u-1/trust-history');
  });

  it('returns null on 404', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(404, 'no history'));
    const { result } = renderHook(() => useTrustHistory('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('returns null on 500 (graceful degrade)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(500, 'svc down'));
    const { result } = renderHook(() => useTrustHistory('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404/500 errors so caller sees real bugs', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(403, 'forbidden'));
    const { result } = renderHook(() => useTrustHistory('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });
});

describe('useTierRequirements', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the tier requirements list', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ tiers: [{ tier: 'gold', min_score: 80 }] });
    const { result } = renderHook(() => useTierRequirements(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data?.tiers).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/trust/tiers');
  });

  it('returns null on 500', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(500, 'down'));
    const { result } = renderHook(() => useTierRequirements(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404/500 errors so caller sees real bugs', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(401, 'unauthorized'));
    const { result } = renderHook(() => useTierRequirements(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });
});
