import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCreateExpense, useDeleteExpense, useExpenses } from '@/hooks/useExpenses';
import type { ExpensesResponse, ProviderExpense } from '@/types';
import { toast } from 'sonner';

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

const mockExpense: ProviderExpense = {
  id: 'exp-1',
  provider_id: 'prov-1',
  category: 'transportation',
  description: 'Diesel for truck',
  amount_cents: 7500,
  receipt_url: 'https://s3/receipt.png',
  expense_date: '2026-04-01',
  created_at: '2026-04-01T00:00:00Z',
};

describe('useExpenses', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches expenses with no params', async () => {
    const response: ExpensesResponse = { expenses: [mockExpense], total_cents: 7500 };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useExpenses(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.expenses).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/expenses');
  });

  it('appends category + date range as query params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ expenses: [], total_cents: 0 });

    const { result } = renderHook(
      () => useExpenses({ category: 'fuel', start_date: '2026-01-01', end_date: '2026-04-01' }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/providers/me/expenses?category=fuel&start_date=2026-01-01&end_date=2026-04-01',
    );
  });

  it('returns null on 404 (graceful degrade)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(404, 'no expenses'));
    const { result } = renderHook(() => useExpenses(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('returns null on 500 (graceful degrade)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(500, 'svc down'));
    const { result } = renderHook(() => useExpenses(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404/500 errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(403, 'forbidden'));
    const { result } = renderHook(() => useExpenses(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });
});

describe('useCreateExpense', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts expense, unwraps { expense }, and invalidates expenses cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ expense: mockExpense });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateExpense(), { wrapper: wrap(client) });
    const payload = {
      category: 'fuel',
      description: 'Diesel',
      amount_cents: 7500,
      expense_date: '2026-04-01',
    };
    result.current.mutate(payload);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/providers/me/expenses', payload);
    expect(result.current.data?.id).toBe('exp-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['expenses'] });
  });

  it('shows toast.error on create failure (covers onError)', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useCreateExpense(), { wrapper: wrap(client) });
    result.current.mutate({
      category: 'fuel',
      description: 'Diesel',
      amount_cents: 7500,
      expense_date: '2026-04-01',
    });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to add expense');
  });
});

describe('useDeleteExpense', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('deletes by id and invalidates expenses cache', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteExpense(), { wrapper: wrap(client) });
    result.current.mutate('exp-1');
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/api/v1/providers/me/expenses/exp-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['expenses'] });
  });

  it('shows toast.error on delete failure (covers onError)', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useDeleteExpense(), { wrapper: wrap(client) });
    result.current.mutate('exp-1');
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to delete expense');
  });
});
