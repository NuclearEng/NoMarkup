// useInstallments — the schedule built from a real BNPL plan (the existing
// test only covers the legacy payments-derived fallback), wired through the
// real useContract / usePayments hooks with only the transport stubbed; plus
// the plans-list shape with neither `plans` nor `installment_plans`.
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useContractInstallmentPlan, useInstallmentSchedule } from '@/hooks/useInstallments';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: mocks.get, post: vi.fn() } };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let h: QueryHarness;

/** Route GETs by exact path; an unrouted path fails the query loudly. */
function route(routes: Record<string, unknown>): void {
  mocks.get.mockImplementation((path) =>
    path in routes
      ? Promise.resolve(routes[path])
      : Promise.reject(new Error(`unexpected GET ${path}`)),
  );
}

function scheduled(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `si-${String(n)}`,
    installment_number: n,
    amount_cents: 2500,
    due_date: `2026-0${String(n)}-01`,
    status: 'scheduled',
    payment_id: null,
    paid_at: null,
    ...overrides,
  };
}

const CONTRACT_PATH = '/api/v1/contracts/c-1';
const PAYMENTS_PATH = '/api/v1/payments';
const PLANS_PATH = '/api/v1/payments/installment-plans';

beforeEach(() => {
  vi.clearAllMocks();
  h = createQueryHarness();
});

afterEach(() => {
  h.queryClient.clear();
});

describe('useInstallmentSchedule — BNPL plan present', () => {
  it('uses the plan schedule (sorted by number), not the payments list', async () => {
    route({
      [CONTRACT_PATH]: { id: 'c-1', amount_cents: 10_000 },
      // A legacy installment payment that must be ignored once a plan exists.
      [PAYMENTS_PATH]: {
        payments: [
          { id: 'p-1', contract_id: 'c-1', installment_number: 1, total_installments: 2, amount_cents: 999, status: 'completed' },
        ],
      },
      [PLANS_PATH]: { plans: [{ id: 'plan-other', contract_id: 'c-2' }, { id: 'plan-1', contract_id: 'c-1' }] },
      [`${PLANS_PATH}/plan-1`]: {
        id: 'plan-1',
        contract_id: 'c-1',
        installment_count: 4,
        installments: [
          scheduled(3),
          scheduled(1, { status: 'paid', paid_at: '2026-01-02T00:00:00Z' }),
          scheduled(2, { amount_cents: 2600 }),
        ],
      },
    });

    const { result } = renderHook(() => useInstallmentSchedule('c-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.installments).toHaveLength(3);
    });
    expect(result.current.installments).toEqual([
      {
        installment_number: 1,
        total_installments: 4,
        amount_cents: 2500,
        status: 'paid',
        due_date: '2026-01-01',
        paid_at: '2026-01-02T00:00:00Z',
      },
      {
        installment_number: 2,
        total_installments: 4,
        amount_cents: 2600,
        status: 'scheduled',
        due_date: '2026-02-01',
        paid_at: undefined,
      },
      {
        installment_number: 3,
        total_installments: 4,
        amount_cents: 2500,
        status: 'scheduled',
        due_date: '2026-03-01',
        paid_at: undefined,
      },
    ]);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(mocks.get).toHaveBeenCalledWith(`${PLANS_PATH}/plan-1`);
  });

  it('falls back to the payments-derived schedule when the plan has no scheduled rows', async () => {
    route({
      [CONTRACT_PATH]: { id: 'c-1', amount_cents: 9_000 },
      [PAYMENTS_PATH]: {
        payments: [
          {
            id: 'p-1',
            contract_id: 'c-1',
            installment_number: 1,
            total_installments: 3,
            amount_cents: 3100,
            status: 'completed',
            created_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T01:00:00Z',
          },
          // Wrong contract and single-payment rows are not part of this schedule.
          { id: 'p-x', contract_id: 'c-2', installment_number: 2, total_installments: 3, amount_cents: 1 },
          { id: 'p-y', contract_id: 'c-1', installment_number: 1, total_installments: 1, amount_cents: 1 },
        ],
      },
      [PLANS_PATH]: { plans: [{ id: 'plan-1', contract_id: 'c-1' }] },
      [`${PLANS_PATH}/plan-1`]: { id: 'plan-1', contract_id: 'c-1', installment_count: 3, installments: [] },
    });

    const { result } = renderHook(() => useInstallmentSchedule('c-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.installments).toHaveLength(3);
    });
    expect(result.current.installments).toEqual([
      {
        installment_number: 1,
        total_installments: 3,
        amount_cents: 3100,
        status: 'completed',
        due_date: '2026-01-01T00:00:00Z',
        paid_at: '2026-01-01T01:00:00Z',
      },
      { installment_number: 2, total_installments: 3, amount_cents: 3000, status: 'upcoming', due_date: undefined, paid_at: undefined },
      { installment_number: 3, total_installments: 3, amount_cents: 3000, status: 'upcoming', due_date: undefined, paid_at: undefined },
    ]);
  });

  it('never requests a plan detail when the contract has no plan', async () => {
    route({
      [CONTRACT_PATH]: { id: 'c-1', amount_cents: 9_000 },
      [PAYMENTS_PATH]: { payments: [] },
      [PLANS_PATH]: { plans: [] },
    });

    const { result } = renderHook(() => useInstallmentSchedule('c-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.installments).toEqual([]);
    expect(mocks.get.mock.calls.map((c) => c[0]).sort()).toEqual(
      [CONTRACT_PATH, PAYMENTS_PATH, PLANS_PATH].sort(),
    );
  });
});

describe('useContractInstallmentPlan — unexpected list shapes', () => {
  it('reports no plan when the response has neither `plans` nor `installment_plans`', async () => {
    route({ [PLANS_PATH]: { pagination: { total_count: 0 } } });

    const { result } = renderHook(() => useContractInstallmentPlan('c-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.plan).toBeUndefined();
    expect(result.current.hasPlan).toBe(false);
  });

  it('prefers `plans` over `installment_plans` when both are present', async () => {
    route({
      [PLANS_PATH]: {
        plans: [{ id: 'from-plans', contract_id: 'c-1' }],
        installment_plans: [{ id: 'from-gateway', contract_id: 'c-1' }],
      },
    });

    const { result } = renderHook(() => useContractInstallmentPlan('c-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.hasPlan).toBe(true);
    });
    expect(result.current.plan?.id).toBe('from-plans');
  });

  it('has no plan while the list request fails', async () => {
    mocks.get.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useContractInstallmentPlan('c-1'), { wrapper: h.wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.hasPlan).toBe(false);
  });
});
