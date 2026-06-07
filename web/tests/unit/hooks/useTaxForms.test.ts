import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useGenerateInvoice,
  useGenerateTaxForm,
  useTaxForms,
} from '@/hooks/useTaxForms';
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
  downloadAuthenticated: vi.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
  getApiErrorMessage: (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback,
}));

const { api, downloadAuthenticated } = await import('@/lib/api');

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

describe('useTaxForms', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the provider tax-forms list', async () => {
    const response = { tax_forms: [{ id: 'tf-1', year: 2025 }] };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useTaxForms(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data).toEqual(response);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/tax-forms');
  });
});

describe('useGenerateTaxForm', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts to the year-scoped generate endpoint, unwraps tax_form, invalidates tax-forms', async () => {
    const taxForm = { id: 'tf-1', year: 2025 };
    vi.mocked(api.post).mockResolvedValueOnce({ tax_form: taxForm });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useGenerateTaxForm(), { wrapper: wrap(client) });
    result.current.mutate(2025);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/providers/me/tax-forms/2025/generate',
    );
    expect(result.current.data).toEqual(taxForm);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tax-forms'] });
  });

  it('shows toast.error on tax-form generation failure (covers onError)', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useGenerateTaxForm(), { wrapper: wrap(client) });
    result.current.mutate(2025);
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    // getApiErrorMessage surfaces the Error reason; the literal stays as the fallback.
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('boom');
  });
});

describe('useGenerateInvoice', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts to /invoice, then triggers an authenticated download, then invalidates invoices', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ invoice_url: '/api/v1/contracts/c-1/invoice/download' });
    vi.mocked(downloadAuthenticated).mockResolvedValueOnce(undefined);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useGenerateInvoice(), { wrapper: wrap(client) });
    result.current.mutate('c-1');
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/contracts/c-1/invoice');
    expect(vi.mocked(downloadAuthenticated)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/invoice/download',
      'invoice-c-1.html',
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['invoices'] });
  });

  it('shows the Error.message on invoice failure (covers onError Error branch)', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useGenerateInvoice(), { wrapper: wrap(client) });
    result.current.mutate('c-1');
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('network down');
  });

  it('shows fallback message on non-Error rejection (covers onError fallback branch)', async () => {
    // Reject with a non-Error value — exercises the `err instanceof Error ? ... : fallback` branch.
    vi.mocked(api.post).mockRejectedValueOnce('boom');
    const { result } = renderHook(() => useGenerateInvoice(), { wrapper: wrap(client) });
    result.current.mutate('c-1');
    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to generate invoice');
  });
});
