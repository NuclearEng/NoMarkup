import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useFraudAlerts,
  useReviewFraudAlert,
  useUserRiskProfile,
} from '@/hooks/useFraud';

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

describe('useFraudAlerts', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches with no params (no query string)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ alerts: [], total: 0 });
    const { result } = renderHook(() => useFraudAlerts(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/fraud/alerts');
  });

  it('encodes status + risk_level + page + page_size', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ alerts: [], total: 0 });
    const { result } = renderHook(
      () => useFraudAlerts({ status: 'open', risk_level: 'high', page: 2, pageSize: 25 }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/admin/fraud/alerts?status=open&risk_level=high&page=2&page_size=25',
    );
  });
});

describe('useReviewFraudAlert', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts review payload, unwraps alert, invalidates fraud-alerts', async () => {
    const alert = { id: 'a-1', status: 'reviewed' };
    vi.mocked(api.post).mockResolvedValueOnce({ alert });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useReviewFraudAlert(), { wrapper: wrap(client) });
    result.current.mutate({
      alertId: 'a-1',
      input: { action: 'dismiss', notes: 'false positive' },
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/admin/fraud/alerts/a-1/review',
      { action: 'dismiss', notes: 'false positive' },
    );
    expect(result.current.data).toEqual(alert);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['fraud-alerts'] });
  });
});

describe('useUserRiskProfile', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the per-user risk profile', async () => {
    const profile = { user_id: 'u-1', risk_score: 42, risk_level: 'medium' };
    vi.mocked(api.get).mockResolvedValueOnce(profile);

    const { result } = renderHook(() => useUserRiskProfile('u-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data).toEqual(profile);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/fraud/users/u-1/risk');
  });

  it('does not fetch with empty userId', () => {
    const { result } = renderHook(() => useUserRiskProfile(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});
