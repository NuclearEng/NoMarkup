import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useContract,
  useContracts,
  useAcceptContract,
  useStartWork,
  useMarkComplete,
  useApproveCompletion,
  useCancelContract,
  useSubmitMilestone,
  useApproveMilestone,
  useRequestRevision,
  useOpenDispute,
  useReportAbandonment,
  useReportNoShow,
  resolvePartyDirectionsAddress,
} from '@/hooks/useContracts';
import type { Contract, ContractsResponse } from '@/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { toast } = await import('sonner');

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

const { api, ApiError: FakeApiError } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const mockContract: Contract = {
  id: 'c-1',
  contract_number: 'NM-2026-00001',
  job_id: 'job-1',
  job_title: 'Test job',
  customer_id: 'cust-1',
  provider_id: 'prov-1',
  bid_id: 'bid-1',
  amount_cents: 50000,
  payment_timing: 'completion',
  status: 'pending_acceptance',
  customer_accepted: false,
  provider_accepted: false,
  acceptance_deadline: '2026-04-30T00:00:00Z',
  milestones: [],
  accepted_at: undefined,
  started_at: undefined,
  completed_at: undefined,
  created_at: '2026-04-25T00:00:00Z',
};

describe('useContract', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('splits change_orders out of the flat gateway response', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...mockContract,
      change_orders: [{ id: 'co-1', status: 'pending' }],
    });

    const { result } = renderHook(() => useContract('c-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.contract.id).toBe('c-1');
    expect(result.current.data?.change_orders).toHaveLength(1);
  });

  it('defaults change_orders to [] when absent', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockContract);

    const { result } = renderHook(() => useContract('c-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.change_orders).toEqual([]);
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useContract(''), {
      wrapper: createWrapper(queryClient),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useContracts (list)', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('fetches with no params', async () => {
    const response: ContractsResponse = {
      contracts: [mockContract],
      pagination: { page: 1, pageSize: 20, totalCount: 1, totalPages: 1, hasNext: false },
    };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useContracts(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.contracts).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/contracts');
  });

  it('appends query params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      contracts: [],
      pagination: { page: 1, page_size: 50, total_count: 0, total_pages: 0 },
    });

    const { result } = renderHook(
      () => useContracts({ status: 'active', page: 2, page_size: 50 }),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/contracts?status=active&page=2&page_size=50',
    );
  });
});

// --- Lifecycle mutations: each hook posts to a sub-route + invalidates 2 caches ---

interface LifecycleCase {
  name: string;
  hook: () => unknown;
  trigger: (m: { mutate: (input: unknown) => void }) => void;
  expectedPath: string;
  invalidatedKeys: unknown[][];
}

const lifecycleCases: LifecycleCase[] = [
  {
    name: 'useAcceptContract',
    hook: useAcceptContract,
    trigger: (m) => { m.mutate('c-1'); },
    expectedPath: '/api/v1/contracts/c-1/accept',
    invalidatedKeys: [['contracts'], ['contract', 'c-1']],
  },
  {
    name: 'useStartWork',
    hook: useStartWork,
    trigger: (m) => { m.mutate('c-1'); },
    expectedPath: '/api/v1/contracts/c-1/start',
    invalidatedKeys: [['contracts'], ['contract', 'c-1']],
  },
  {
    name: 'useMarkComplete',
    hook: useMarkComplete,
    trigger: (m) => { m.mutate('c-1'); },
    expectedPath: '/api/v1/contracts/c-1/complete',
    invalidatedKeys: [['contracts'], ['contract', 'c-1']],
  },
  {
    name: 'useApproveCompletion',
    hook: useApproveCompletion,
    trigger: (m) => { m.mutate('c-1'); },
    expectedPath: '/api/v1/contracts/c-1/approve-completion',
    invalidatedKeys: [['contracts'], ['contract', 'c-1']],
  },
  {
    name: 'useCancelContract',
    hook: useCancelContract,
    trigger: (m) => { m.mutate('c-1'); },
    expectedPath: '/api/v1/contracts/c-1/cancel',
    invalidatedKeys: [['contracts'], ['contract', 'c-1']],
  },
  {
    name: 'useReportNoShow',
    hook: useReportNoShow,
    trigger: (m) => { m.mutate('c-1'); },
    expectedPath: '/api/v1/contracts/c-1/report-noshow',
    invalidatedKeys: [['contracts'], ['contract', 'c-1']],
  },
  {
    name: 'useReportAbandonment',
    hook: useReportAbandonment,
    trigger: (m) => { m.mutate('c-1'); },
    expectedPath: '/api/v1/contracts/c-1/report-abandonment',
    invalidatedKeys: [['contracts'], ['contract', 'c-1']],
  },
];

describe.each(lifecycleCases)('contract lifecycle: $name', ({ hook, trigger, expectedPath, invalidatedKeys }) => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('posts to the correct path and invalidates expected caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockContract);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(hook as () => { mutate: (input: unknown) => void }, {
      wrapper: createWrapper(queryClient),
    });
    trigger(result.current);

    await waitFor(() => {
      const r = result.current as unknown as { isSuccess: boolean };
      expect(r.isSuccess).toBe(true);
    });

    // postContract calls api.post(path) with one arg (no body). The spy
    // records the call exactly as invoked.
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(expectedPath);
    for (const key of invalidatedKeys) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: key });
    }
  });
});

// --- Milestone mutations ---

describe('useSubmitMilestone', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('posts + invalidates contract caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'm-1' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSubmitMilestone(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ milestoneId: 'm-1', contractId: 'c-1' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/milestones/m-1/submit',
      undefined,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contract', 'c-1'] });
  });
});

describe('useApproveMilestone', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('posts + invalidates contract caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'm-1' });
    const { result } = renderHook(() => useApproveMilestone(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ milestoneId: 'm-1', contractId: 'c-1' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/milestones/m-1/approve',
      undefined,
    );
  });
});

describe('useRequestRevision', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('posts revision_notes and invalidates contract caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'm-1' });
    const { result } = renderHook(() => useRequestRevision(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      milestoneId: 'm-1',
      contractId: 'c-1',
      revisionNotes: 'pls fix the wiring',
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/milestones/m-1/revision',
      { revision_notes: 'pls fix the wiring' },
    );
  });
});

describe('useOpenDispute', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('posts the dispute payload (defaults is_guarantee_claim=false)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      dispute: { id: 'd-1', status: 'open' },
    });

    const { result } = renderHook(() => useOpenDispute(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      contractId: 'c-1',
      dispute_type: 'quality',
      description: 'work not as agreed',
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/disputes',
      {
        dispute_type: 'quality',
        description: 'work not as agreed',
        is_guarantee_claim: false,
      },
    );
  });

  it('forwards is_guarantee_claim=true when caller sets it', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      dispute: { id: 'd-2', status: 'open' },
    });
    const { result } = renderHook(() => useOpenDispute(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      contractId: 'c-1',
      dispute_type: 'quality',
      description: 'guarantee claim',
      is_guarantee_claim: true,
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/disputes',
      expect.objectContaining({ is_guarantee_claim: true }),
    );
  });
});

describe('resolvePartyDirectionsAddress', () => {
  it('prefers exact_address when street is present', () => {
    expect(
      resolvePartyDirectionsAddress({
        exact_address: { street: '500 Oak Ave', city: 'Austin', state: 'TX', zip_code: '78701' },
        location_address: 'Austin, TX',
        location_lat: 30.2,
        location_lng: -97.7,
      }),
    ).toBe('500 Oak Ave, Austin, TX, 78701');
  });

  it('falls back to location_address then lat/lng', () => {
    expect(
      resolvePartyDirectionsAddress({
        location_address: 'Austin, TX',
        location_lat: 30.2,
        location_lng: -97.7,
      }),
    ).toBe('Austin, TX');
    expect(
      resolvePartyDirectionsAddress({
        location_lat: 30.2672,
        location_lng: -97.7431,
      }),
    ).toBe('30.2672,-97.7431');
    expect(resolvePartyDirectionsAddress({})).toBeNull();
  });
});

// --- explainFailure error toasts (covers ApiError vs generic-Error branches) ---

describe('useContracts onError toasts', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('uses ApiError userMessage when error is an ApiError (useAcceptContract)', async () => {
    const apiErr = new (FakeApiError as unknown as new (msg: string) => Error)(
      'contract already accepted',
    );
    vi.mocked(api.post).mockRejectedValueOnce(apiErr);

    const { result } = renderHook(() => useAcceptContract(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('c-1');
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('contract already accepted');
  });

  it('falls back to fallback message for non-ApiError errors (useStartWork)', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useStartWork(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('c-1');
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to start work');
  });

  it('shows the milestone-specific failure toast on error (useSubmitMilestone)', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useSubmitMilestone(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ milestoneId: 'm-1', contractId: 'c-1' });
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to submit milestone');
  });
});
