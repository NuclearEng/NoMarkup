import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCreateProperty,
  useDeleteProperty,
  useProperties,
  useUpdateProperty,
} from '@/hooks/useProperties';
import type { Property } from '@/hooks/useProperties';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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

const mockProp: Property = {
  id: 'p-1',
  nickname: 'Pine St',
  address: '123 Pine',
  city: 'Seattle',
  state: 'WA',
  zip_code: '98101',
  notes: null,
  active_jobs: 0,
  total_spend_cents: 0,
  created_at: '2026-04-25T00:00:00Z',
};

describe('useProperties (list)', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('unwraps { properties } from the gateway response into an array', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ properties: [mockProp] });
    const { result } = renderHook(() => useProperties(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toEqual([mockProp]);
  });
});

describe('useCreateProperty', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts + returns the unwrapped property', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockProp);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateProperty(), { wrapper: wrap(client) });
    result.current.mutate({
      nickname: 'Pine St',
      address: '123 Pine',
      city: 'Seattle',
      state: 'WA',
      zip_code: '98101',
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.id).toBe('p-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['properties'] });
  });
});

describe('useUpdateProperty', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('uses PUT (not PATCH — gateway returns 405 on PATCH)', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ ...mockProp, nickname: 'Pine St (renamed)' });
    const { result } = renderHook(() => useUpdateProperty(), { wrapper: wrap(client) });
    result.current.mutate({ id: 'p-1', input: { nickname: 'Pine St (renamed)' } });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith(
      '/api/v1/properties/p-1',
      { nickname: 'Pine St (renamed)' },
    );
    // Verify PATCH was NOT called — the bug fix this hook embeds.
    expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
  });
});

describe('useDeleteProperty', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('deletes by id + invalidates list', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteProperty(), { wrapper: wrap(client) });
    result.current.mutate('p-1');
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/api/v1/properties/p-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['properties'] });
  });
});
