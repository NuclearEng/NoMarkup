// useInsuranceMarketplace — competitive insurance quotes: request (idempotent,
// seeds the detail cache so the comparison view needs no extra round-trip),
// read (disabled until an id exists) and bind (idempotent, refreshes the
// request and the caller's policies).
//
// The real ApiError / getApiErrorMessage are kept so the toast copy is the
// genuine mapping; only the transport and idempotency helpers are replaced.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useQuoteRequest, useRequestQuotes, useSelectQuote } from '@/hooks/useInsuranceMarketplace';
import type { InsuranceQuoteRequestDetail } from '@/types';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => {
      toastSuccess(...a);
    },
    error: (...a: unknown[]) => {
      toastError(...a);
    },
  },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
    },
    idempotencyHeader: (key: string) => ({ 'Idempotency-Key': key }),
    clearIdempotencyKey: vi.fn(),
  };
});

const { api, ApiError, clearIdempotencyKey } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const quotes = [
  {
    quote_id: 'q-1',
    insurer_id: 'ins-1',
    insurer_name: 'Acme Mutual',
    premium_cents: 4200,
    deductible_cents: 25000,
    terms: '12 months',
    expires_at: '2026-12-01T00:00:00Z',
  },
];

const input = { product_type: 'workmanship', coverage_cents: 500000, contract_id: 'ct-1' };

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = createTestQueryClient();
});

afterEach(() => {
  vi.useRealTimers();
  queryClient.clear();
});

describe('useRequestQuotes', () => {
  it('posts with a product+coverage idempotency key and seeds the detail cache from the echo', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      request_id: 'req-1',
      quotes,
      product_type: 'workmanship',
      coverage_cents: 500000,
      contract_id: 'ct-1',
      status: 'quoted',
      created_at: '2026-11-16T10:00:00Z',
    });

    const { result } = renderHook(() => useRequestQuotes(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/insurance/quote-requests', input, {
      'Idempotency-Key': 'insurance-quote:workmanship:500000',
    });
    expect(vi.mocked(clearIdempotencyKey)).toHaveBeenCalledWith(
      'insurance-quote:workmanship:500000',
    );
    expect(queryClient.getQueryData(['insurance-quote-request', 'req-1'])).toEqual({
      request: {
        id: 'req-1',
        product_type: 'workmanship',
        coverage_cents: 500000,
        contract_id: 'ct-1',
        status: 'quoted',
        created_at: '2026-11-16T10:00:00Z',
      },
      quotes,
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('fills neutral defaults when the gateway echoes only the id and quotes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T12:34:56.000Z'));
    vi.mocked(api.post).mockResolvedValueOnce({ request_id: 'req-2', quotes: [] });

    const { result } = renderHook(() => useRequestQuotes(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ product_type: 'liability', coverage_cents: 100 });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryClient.getQueryData(['insurance-quote-request', 'req-2'])).toEqual({
      request: {
        id: 'req-2',
        product_type: '',
        coverage_cents: 0,
        contract_id: null,
        status: 'open',
        created_at: '2026-11-16T12:34:56.000Z',
      },
      quotes: [],
    });
  });

  it('the seeded detail is what useQuoteRequest then reads, with no GET', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ request_id: 'req-3', quotes, status: 'quoted' });
    const seeded = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    const request = renderHook(() => useRequestQuotes(), { wrapper: createWrapper(seeded) });
    request.result.current.mutate(input);
    await waitFor(() => {
      expect(request.result.current.isSuccess).toBe(true);
    });

    const detail = renderHook(() => useQuoteRequest('req-3'), { wrapper: createWrapper(seeded) });

    expect(detail.result.current.data?.quotes).toEqual(quotes);
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
    seeded.clear();
  });

  it('keeps the sticky key and seeds nothing when the request fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(400, JSON.stringify({ error: 'coverage must be at least 10000 cents' })),
    );

    const { result } = renderHook(() => useRequestQuotes(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('coverage must be at least $100.00');
    expect(vi.mocked(clearIdempotencyKey)).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('uses the fallback copy for a failure with no message', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(undefined);

    const { result } = renderHook(() => useRequestQuotes(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('Could not request insurance quotes');
  });
});

describe('useQuoteRequest', () => {
  it('GETs the request by id under its key', async () => {
    const detail = { request: { id: 'req-9' }, quotes } as unknown as InsuranceQuoteRequestDetail;
    vi.mocked(api.get).mockResolvedValueOnce(detail);

    const { result } = renderHook(() => useQuoteRequest('req-9'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/insurance/quote-requests/req-9');
    expect(queryClient.getQueryData(['insurance-quote-request', 'req-9'])).toEqual(detail);
  });

  it.each([null, undefined, ''])('is disabled for id %j', (id) => {
    const { result } = renderHook(() => useQuoteRequest(id), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('surfaces a failed read as an error', async () => {
    const failure = new ApiError(404, 'not found');
    vi.mocked(api.get).mockRejectedValueOnce(failure);

    const { result } = renderHook(() => useQuoteRequest('req-missing'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
  });
});

describe('useSelectQuote', () => {
  it('binds the quote idempotently and refreshes the request + my policies', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ policy_id: 'pol-1', status: 'bound' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSelectQuote('req-1'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('q-1');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/insurance/quote-requests/req-1/select',
      { quote_id: 'q-1' },
      { 'Idempotency-Key': 'insurance-select:req-1:q-1' },
    );
    expect(vi.mocked(clearIdempotencyKey)).toHaveBeenCalledWith('insurance-select:req-1:q-1');
    expect(toastSuccess).toHaveBeenCalledWith('Policy bound — you are covered');
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['insurance-quote-request', 'req-1'],
      ['my-policies'],
    ]);
  });

  it('does not claim coverage, clear the key or refresh when binding fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: 'quote expired' })),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSelectQuote('req-1'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('q-1');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('quote expired');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(vi.mocked(clearIdempotencyKey)).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('uses the fallback copy for an oversized non-JSON error body', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(502, '<html>'.repeat(60)));

    const { result } = renderHook(() => useSelectQuote('req-1'), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('q-1');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('Could not bind this policy');
  });
});
