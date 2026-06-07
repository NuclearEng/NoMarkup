import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCreateInstallmentPlan,
  useInstallmentPlan,
  useInstallmentSchedule,
  useMyInstallmentPlans,
} from '@/hooks/useInstallments';
import type {
  CreateInstallmentPlanInput,
  InstallmentPlan,
  InstallmentPlansResponse,
} from '@/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) { return this.message || fallback; }
  },
  getApiErrorMessage: (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback,
}));

// Mock the dependent hooks so useInstallmentSchedule can be tested in isolation.
vi.mock('@/hooks/useContracts', () => ({
  useContract: vi.fn(),
}));
vi.mock('@/hooks/usePayments', () => ({
  usePayments: vi.fn(),
}));

const { api } = await import('@/lib/api');
const { useContract } = await import('@/hooks/useContracts');
const { usePayments } = await import('@/hooks/usePayments');

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

const mockPlan: InstallmentPlan = {
  id: 'plan-1',
  contract_id: 'c-1',
  customer_id: 'cust-1',
  provider_id: 'prov-1',
  total_amount_cents: 90000,
  bnpl_fee_cents: 0,
  total_with_fee_cents: 90000,
  installment_count: 3,
  per_installment_cents: 30000,
  fee_rate: 0,
  status: 'active',
  provider_paid_at: null,
  installments: [],
  created_at: '2026-04-25T00:00:00Z',
};

describe('useCreateInstallmentPlan', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('posts plan, unwraps { plan }, and invalidates installment-plans + payments caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ plan: mockPlan });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const input: CreateInstallmentPlanInput = {
      contract_id: 'c-1',
      customer_id: 'cust-1',
      provider_id: 'prov-1',
      total_amount_cents: 90000,
      installment_count: 3,
      payment_method_id: 'pm-1',
      idempotency_key: 'idem-1',
    };

    const { result } = renderHook(() => useCreateInstallmentPlan(), { wrapper: wrap(client) });
    result.current.mutate(input);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/payments/installment-plans',
      input,
    );
    expect(result.current.data?.id).toBe('plan-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['installment-plans'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['payments'] });
  });

  it('shows an error toast when plan creation fails', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValueOnce(new Error('insufficient funds'));

    const input: CreateInstallmentPlanInput = {
      contract_id: 'c-2',
      customer_id: 'cust-2',
      provider_id: 'prov-2',
      total_amount_cents: 60000,
      installment_count: 3,
      payment_method_id: 'pm-2',
      idempotency_key: 'idem-2',
    };

    const { result } = renderHook(() => useCreateInstallmentPlan(), { wrapper: wrap(client) });
    result.current.mutate(input);
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    // getApiErrorMessage surfaces the Error reason; the literal stays as the fallback.
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('insufficient funds');
  });
});

describe('useInstallmentPlan', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('wraps the bare plan response in { plan }', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockPlan);

    const { result } = renderHook(() => useInstallmentPlan('plan-1'), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.plan.id).toBe('plan-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/payments/installment-plans/plan-1');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useInstallmentPlan(''), { wrapper: wrap(client) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useMyInstallmentPlans', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('fetches the plans list', async () => {
    const response: InstallmentPlansResponse = {
      plans: [mockPlan],
      pagination: {
        page: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
        hasNext: false,
      },
    };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => useMyInstallmentPlans(), { wrapper: wrap(client) });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.plans).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/payments/installment-plans');
  });
});

describe('useInstallmentSchedule', () => {
  let client: QueryClient;
  beforeEach(() => { vi.resetAllMocks(); client = qc(); });
  afterEach(() => { client.clear(); });

  it('returns empty schedule when contract or payments data is missing', () => {
    vi.mocked(useContract).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useContract>);
    vi.mocked(usePayments).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof usePayments>);

    const { result } = renderHook(() => useInstallmentSchedule('c-1'), { wrapper: wrap(client) });

    expect(result.current.installments).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('returns empty schedule when contract has no installment-tagged payments', () => {
    vi.mocked(useContract).mockReturnValue({
      data: { contract: { amount_cents: 90000 }, change_orders: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useContract>);
    vi.mocked(usePayments).mockReturnValue({
      data: { payments: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof usePayments>);

    const { result } = renderHook(() => useInstallmentSchedule('c-1'), { wrapper: wrap(client) });

    expect(result.current.installments).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('builds a schedule entry per installment and uses contract amount as fallback for missing slots', () => {
    vi.mocked(useContract).mockReturnValue({
      data: { contract: { amount_cents: 90000 }, change_orders: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useContract>);
    vi.mocked(usePayments).mockReturnValue({
      data: {
        payments: [
          {
            contract_id: 'c-1',
            installment_number: 1,
            total_installments: 3,
            amount_cents: 30000,
            status: 'released',
            created_at: '2026-04-01',
            completed_at: '2026-04-02',
          },
          {
            contract_id: 'c-1',
            installment_number: 2,
            total_installments: 3,
            amount_cents: 30000,
            status: 'pending',
            created_at: '2026-05-01',
          },
          // installment 3 intentionally missing — should fall back to contract average.
          // Different contract — must be filtered out.
          {
            contract_id: 'OTHER',
            installment_number: 1,
            total_installments: 3,
            amount_cents: 99999,
            status: 'released',
            created_at: '2026-04-01',
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof usePayments>);

    const { result } = renderHook(() => useInstallmentSchedule('c-1'), { wrapper: wrap(client) });

    expect(result.current.installments).toHaveLength(3);
    expect(result.current.installments[0]?.status).toBe('released');
    expect(result.current.installments[0]?.paid_at).toBe('2026-04-02');
    expect(result.current.installments[1]?.status).toBe('pending');
    // Missing slot 3 → fallback to contract.amount_cents / total.
    expect(result.current.installments[2]?.status).toBe('upcoming');
    expect(result.current.installments[2]?.amount_cents).toBe(30000);
  });
});
