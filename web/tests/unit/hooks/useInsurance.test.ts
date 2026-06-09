import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAdminInsuranceClaims,
  useFileInsuranceClaim,
  useInsuranceClaim,
  useInsurancePolicy,
  useInsuranceProducts,
  useInsuranceQuote,
  useMyPolicies,
  usePurchaseInsurance,
  useReviewInsuranceClaim,
} from '@/hooks/useInsurance';
import type {
  FileInsuranceClaimInput,
  InsuranceClaim,
  InsurancePolicy,
  InsuranceProduct,
  InsuranceQuote,
} from '@/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { toast } = await import('sonner');

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) { return this.message || fallback; }
  },
  getApiErrorMessage: (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback,
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

const mockProduct: InsuranceProduct = {
  id: 'prod-1',
  name: 'Standard Coverage',
  slug: 'standard',
  description: 'covers stuff',
  coverage_type: 'damage',
  base_rate_bps: 200,
  min_premium_cents: 1000,
  max_coverage_cents: 1000000,
  coverage_duration_days: 365,
  deductible_cents: 5000,
  terms_markdown: '# terms',
};

const mockQuote: InsuranceQuote = {
  product_id: 'prod-1',
  product_name: 'Standard Coverage',
  premium_cents: 2500,
  coverage_amount_cents: 100000,
  deductible_cents: 5000,
  coverage_duration_days: 365,
};

const mockPolicy: InsurancePolicy = {
  id: 'pol-1',
  policy_number: 'P-001',
  product_id: 'prod-1',
  contract_id: 'c-1',
  coverage_amount_cents: 100000,
  premium_cents: 2500,
  deductible_cents: 5000,
  effective_date: '2026-04-25',
  expiration_date: '2027-04-25',
  status: 'active',
  created_at: '2026-04-25T00:00:00Z',
};

const mockClaim: InsuranceClaim = {
  id: 'clm-1',
  claim_number: 'C-001',
  policy_id: 'pol-1',
  claim_type: 'damage',
  description: 'broken pipe',
  evidence_urls: [],
  claimed_amount_cents: 50000,
  approved_amount_cents: null,
  payout_cents: null,
  status: 'filed',
  denial_reason: null,
  created_at: '2026-04-25T00:00:00Z',
};

describe('useInsuranceProducts', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the product list', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ products: [mockProduct] });

    const { result } = renderHook(() => useInsuranceProducts(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.products).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/insurance/products');
  });
});

describe('useInsuranceQuote', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts contract+product ids and wraps the bare quote in { quote }', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockQuote);

    const { result } = renderHook(() => useInsuranceQuote('c-1', 'prod-1'), {
      wrapper: wrap(client),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/insurance/quote',
      { contract_id: 'c-1', product_id: 'prod-1' },
    );
    expect(result.current.data?.quote.premium_cents).toBe(2500);
  });

  it('does not fetch when contractId is empty', () => {
    const { result } = renderHook(() => useInsuranceQuote('', 'prod-1'), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does not fetch when productId is empty', () => {
    const { result } = renderHook(() => useInsuranceQuote('c-1', ''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('usePurchaseInsurance', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts purchase + invalidates my-policies', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockPolicy as unknown as Record<string, unknown>);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => usePurchaseInsurance(), { wrapper: wrap(client) });
    result.current.mutate({
      contract_id: 'c-1',
      product_id: 'prod-1',
      payment_method_id: 'pm-1',
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/insurance/purchase',
      { contract_id: 'c-1', product_id: 'prod-1', payment_method_id: 'pm-1' },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-policies'] });
  });
});

describe('useMyPolicies', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the policies list', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      policies: [mockPolicy],
      pagination: { total_count: 1 },
    });

    const { result } = renderHook(() => useMyPolicies(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/insurance/policies');
    expect(result.current.data?.policies).toHaveLength(1);
  });
});

describe('useInsurancePolicy', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('wraps the bare policy in { policy }', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockPolicy);

    const { result } = renderHook(() => useInsurancePolicy('pol-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.policy.id).toBe('pol-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/insurance/policies/pol-1');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useInsurancePolicy(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useFileInsuranceClaim', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts claim + invalidates policies and claims caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockClaim as unknown as Record<string, unknown>);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const input: FileInsuranceClaimInput = {
      policy_id: 'pol-1',
      claim_type: 'damage',
      description: 'broken pipe',
      evidence_urls: [],
      claimed_amount_cents: 50000,
    };
    const { result } = renderHook(() => useFileInsuranceClaim(), { wrapper: wrap(client) });
    result.current.mutate(input);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/insurance/claims', input);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-policies'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['insurance-claims'] });
  });

  it('shows the file-claim failure toast on error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));

    const input: FileInsuranceClaimInput = {
      policy_id: 'pol-1',
      claim_type: 'damage',
      description: 'broken pipe',
      evidence_urls: [],
      claimed_amount_cents: 50000,
    };
    const { result } = renderHook(() => useFileInsuranceClaim(), { wrapper: wrap(client) });
    result.current.mutate(input);
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    // getApiErrorMessage surfaces the Error reason; the literal stays as the fallback.
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('boom');
  });
});

describe('useInsuranceClaim', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('wraps the bare claim in { claim }', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockClaim);
    const { result } = renderHook(() => useInsuranceClaim('clm-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.claim.id).toBe('clm-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/insurance/claims/clm-1');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useInsuranceClaim(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAdminInsuranceClaims', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches with no params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      claims: [],
      pagination: { total_count: 0 },
    });
    const { result } = renderHook(() => useAdminInsuranceClaims(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/admin/insurance/claims');
  });

  it('appends status + pagination params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      claims: [],
      pagination: { total_count: 0 },
    });
    const { result } = renderHook(
      () => useAdminInsuranceClaims({ status: 'filed', page: 2, page_size: 25 }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/admin/insurance/claims?status=filed&page=2&page_size=25',
    );
  });
});

describe('useReviewInsuranceClaim', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts approve action + invalidates admin claims cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockClaim as unknown as Record<string, unknown>);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useReviewInsuranceClaim(), { wrapper: wrap(client) });
    result.current.mutate({
      claimId: 'clm-1',
      action: 'approve',
      approved_amount_cents: 45000,
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/admin/insurance/claims/clm-1/review',
      { approved: true, approved_amount_cents: 45000, denial_reason: undefined },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['admin-insurance-claims'] });
  });

  it('posts deny action with denial_reason', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockClaim as unknown as Record<string, unknown>);

    const { result } = renderHook(() => useReviewInsuranceClaim(), { wrapper: wrap(client) });
    result.current.mutate({
      claimId: 'clm-1',
      action: 'deny',
      denial_reason: 'no coverage',
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/admin/insurance/claims/clm-1/review',
      { approved: false, approved_amount_cents: undefined, denial_reason: 'no coverage' },
    );
  });

  it('shows the review failure toast on error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useReviewInsuranceClaim(), { wrapper: wrap(client) });
    result.current.mutate({
      claimId: 'clm-1',
      action: 'approve',
      approved_amount_cents: 45000,
    });
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('boom');
  });
});
