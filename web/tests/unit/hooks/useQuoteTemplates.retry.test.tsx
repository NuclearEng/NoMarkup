// useQuoteTemplates — a failed load follows the query client's retry policy
// unless the caller sets one. The hook used to pass `retry: undefined`, which
// replaced the client default with the library default of three retries, so a
// 403 / 503 from the gated endpoint was requested four times.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useQuoteTemplates } from '@/hooks/useQuoteTemplates';

const apiGet = vi.hoisted(() => vi.fn<(path: string) => Promise<unknown>>());

vi.mock('@/lib/api', () => ({
  api: { get: apiGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function wrapperWith(defaultRetry: boolean | number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: defaultRetry, retryDelay: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockRejectedValue(new Error('forbidden'));
});

describe('useQuoteTemplates retry policy', () => {
  it('uses the client default (no retry) when the caller sets nothing', async () => {
    const { result } = renderHook(() => useQuoteTemplates(), { wrapper: wrapperWith(false) });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('uses the client default when options are given without retry', async () => {
    const { result } = renderHook(() => useQuoteTemplates({ enabled: true }), {
      wrapper: wrapperWith(false),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit retry: false over a retrying client', async () => {
    const { result } = renderHook(() => useQuoteTemplates({ retry: false }), {
      wrapper: wrapperWith(2),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit retry count', async () => {
    const { result } = renderHook(() => useQuoteTemplates({ retry: 1 }), {
      wrapper: wrapperWith(false),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('returns the templates in the order the gateway sent them', async () => {
    apiGet.mockResolvedValue({ templates: [{ id: 't-2' }, { id: 't-1' }] });
    const { result } = renderHook(() => useQuoteTemplates(), { wrapper: wrapperWith(false) });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual([{ id: 't-2' }, { id: 't-1' }]);
  });
});
