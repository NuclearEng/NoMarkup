// useRecurring — the hook half that useRecurring.test.ts (pure helpers) and
// useRecurring.update.test.ts (two PATCH cases) do not reach: the config /
// instances queries and their `enabled` guards, pause / resume / cancel,
// the approve / complete response normalization (money fields are only ever
// copied from the gateway, never invented), visit payment create + capture,
// the remaining update toasts, and the helpers' missing-field defaults.
//
// The real ApiError and getApiErrorMessage are kept so toast copy is the
// genuine mapping; only the transport and idempotency helpers are replaced.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearVisitPaymentIdempotency,
  formatRecurringStatus,
  isRecurringInstanceApprovable,
  isRecurringInstanceCompletable,
  isRecurringInstancePayable,
  useApproveRecurringInstance,
  useCancelRecurring,
  useCompleteRecurringInstance,
  useCreateVisitPayment,
  usePauseRecurring,
  useProcessVisitPayment,
  useRecurringConfig,
  useRecurringInstances,
  useResumeRecurring,
  useUpdateRecurring,
} from '@/hooks/useRecurring';

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
      patch: vi.fn(),
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

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = createTestQueryClient();
});

afterEach(() => {
  queryClient.clear();
});

describe('useRecurringConfig', () => {
  it('GETs the contract recurring config and caches it under its key', async () => {
    const config = { id: 'rc-1', status: 'active' };
    vi.mocked(api.get).mockResolvedValueOnce({ config });

    const { result } = renderHook(() => useRecurringConfig('c-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/contracts/c-1/recurring');
    expect(result.current.data).toEqual(config);
    expect(queryClient.getQueryData(['recurring', 'config', 'c-1'])).toEqual(config);
  });

  it.each([{ config: null }, {}])('resolves to null when the gateway sends %j', async (body) => {
    vi.mocked(api.get).mockResolvedValueOnce(body);

    const { result } = renderHook(() => useRecurringConfig('c-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeNull();
  });

  it.each([
    { name: 'empty contract id', contractId: '', enabled: true },
    { name: 'enabled=false', contractId: 'c-1', enabled: false },
  ])('does not fetch with $name', ({ contractId, enabled }) => {
    const { result } = renderHook(() => useRecurringConfig(contractId, enabled), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('fails soft on a 404 without retrying', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, 'not found'));
    // A client whose default would retry proves the hook's own retry:false.
    const retrying = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });

    const { result } = renderHook(() => useRecurringConfig('c-1'), {
      wrapper: createWrapper(retrying),
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
    retrying.clear();
  });
});

describe('useRecurringInstances', () => {
  it('GETs the first page of 20 visits', async () => {
    const instances = [{ id: 'i-1', status: 'scheduled' }];
    vi.mocked(api.get).mockResolvedValueOnce({ instances });

    const { result } = renderHook(() => useRecurringInstances('c-2'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-2/recurring/instances?page=1&page_size=20',
    );
    expect(queryClient.getQueryData(['recurring', 'instances', 'c-2'])).toEqual(instances);
  });

  it.each([{ instances: null }, {}])('resolves to [] when the gateway sends %j', async (body) => {
    vi.mocked(api.get).mockResolvedValueOnce(body);

    const { result } = renderHook(() => useRecurringInstances('c-2'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it.each([
    { name: 'empty contract id', contractId: '', enabled: true },
    { name: 'enabled=false', contractId: 'c-2', enabled: false },
  ])('does not fetch with $name', ({ contractId, enabled }) => {
    const { result } = renderHook(() => useRecurringInstances(contractId, enabled), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});

describe('pause / resume / cancel', () => {
  interface LifecycleHandle {
    isSuccess: boolean;
    isError: boolean;
    mutate: (contractId: string) => void;
  }

  interface LifecycleCase {
    name: string;
    use: () => LifecycleHandle;
    action: string;
    success: string;
    failure: string;
  }

  const CASES: LifecycleCase[] = [
    {
      name: 'usePauseRecurring',
      use: () => usePauseRecurring(),
      action: 'pause',
      success: 'Recurring schedule paused',
      failure: 'Failed to pause recurring schedule',
    },
    {
      name: 'useResumeRecurring',
      use: () => useResumeRecurring(),
      action: 'resume',
      success: 'Recurring schedule resumed',
      failure: 'Failed to resume recurring schedule',
    },
    {
      name: 'useCancelRecurring',
      use: () => useCancelRecurring(),
      action: 'cancel',
      success: 'Recurring schedule cancelled',
      failure: 'Failed to cancel recurring schedule',
    },
  ];

  it.each(CASES)(
    '$name posts, writes the returned config into the cache and refreshes dependants',
    async ({ use, action, success }) => {
      const config = { id: 'rc-1', status: action };
      vi.mocked(api.post).mockResolvedValueOnce({ config });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
      result.current.mutate('c-7');
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(vi.mocked(api.post)).toHaveBeenCalledWith(`/api/v1/contracts/c-7/recurring/${action}`);
      expect(queryClient.getQueryData(['recurring', 'config', 'c-7'])).toEqual(config);
      expect(toastSuccess).toHaveBeenCalledWith(success);
      expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
        ['recurring', 'config', 'c-7'],
        ['recurring', 'instances', 'c-7'],
        ['contract', 'c-7'],
      ]);
    },
  );

  it.each(CASES)('$name shows the gateway reason for an ApiError', async ({ use }) => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: 'contract is not active' })),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
    result.current.mutate('c-7');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('contract is not active');
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['recurring', 'config', 'c-7'])).toBeUndefined();
  });

  it.each(CASES)('$name shows its fallback for a non-API failure', async ({ use, failure }) => {
    vi.mocked(api.post).mockRejectedValueOnce(new TypeError('network down'));

    const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
    result.current.mutate('c-7');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith(failure);
  });
});

describe('useUpdateRecurring toasts and op keys', () => {
  it('turning auto-approve off says each visit needs approval', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ config: { id: 'rc-1' } });

    const { result } = renderHook(() => useUpdateRecurring(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ contractId: 'c-1', auto_approve: false });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/recurring',
      { auto_approve: false },
      { 'Idempotency-Key': 'recurring-config:c-1:false:' },
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      'Auto-approve turned off — you’ll approve each visit',
    );
    expect(vi.mocked(clearIdempotencyKey)).toHaveBeenCalledWith('recurring-config:c-1:false:');
  });

  it('a rate change wins the toast even when auto_approve is sent with it', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ config: { id: 'rc-1' } });

    const { result } = renderHook(() => useUpdateRecurring(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ contractId: 'c-1', auto_approve: true, proposed_rate_cents: 12500 });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/recurring',
      { auto_approve: true, proposed_rate_cents: 12500 },
      { 'Idempotency-Key': 'recurring-config:c-1:true:12500' },
    );
    expect(toastSuccess).toHaveBeenCalledWith('Proposed rate updated for future visits');
  });

  it('an empty update sends an empty body and the generic toast', async () => {
    const config = { id: 'rc-1', status: 'active' };
    vi.mocked(api.patch).mockResolvedValueOnce({ config });

    const { result } = renderHook(() => useUpdateRecurring(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ contractId: 'c-1' });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.patch).mock.calls[0]).toStrictEqual([
      '/api/v1/contracts/c-1/recurring',
      {},
      { 'Idempotency-Key': 'recurring-config:c-1::' },
    ]);
    expect(toastSuccess).toHaveBeenCalledWith('Recurring schedule updated');
    expect(queryClient.getQueryData(['recurring', 'config', 'c-1'])).toEqual(config);
  });

  it('keeps the sticky key and the cache untouched when the PATCH fails', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(422, ''));

    const { result } = renderHook(() => useUpdateRecurring(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ contractId: 'c-1', proposed_rate_cents: 100 });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('Failed to update recurring schedule');
    expect(vi.mocked(clearIdempotencyKey)).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['recurring', 'config', 'c-1'])).toBeUndefined();
  });
});

describe('approve / complete response normalization', () => {
  interface ActionHandle {
    isSuccess: boolean;
    isError: boolean;
    data: unknown;
    mutate: (variables: { contractId: string; instanceId: string }) => void;
  }

  interface ActionCase {
    name: string;
    use: () => ActionHandle;
    action: string;
    success: string;
    failure: string;
  }

  const ACTIONS: ActionCase[] = [
    {
      name: 'useCompleteRecurringInstance',
      use: () => useCompleteRecurringInstance(),
      action: 'complete',
      success: 'Visit marked complete',
      failure: 'Failed to complete visit',
    },
    {
      name: 'useApproveRecurringInstance',
      use: () => useApproveRecurringInstance(),
      action: 'approve',
      success: 'Visit approved',
      failure: 'Failed to approve visit',
    },
  ];

  const variables = { contractId: 'c-1', instanceId: 'i-9' };

  it.each(ACTIONS)(
    '$name posts to the instance route and refreshes the schedule',
    async ({ use, action, success }) => {
      vi.mocked(api.post).mockResolvedValueOnce({ instance: { id: 'i-9', status: 'completed' } });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
      result.current.mutate(variables);
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        `/api/v1/contracts/c-1/recurring/instances/i-9/${action}`,
      );
      expect(toastSuccess).toHaveBeenCalledWith(success);
      expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
        ['recurring', 'config', 'c-1'],
        ['recurring', 'instances', 'c-1'],
        ['contract', 'c-1'],
      ]);
    },
  );

  it.each(ACTIONS)('$name reports a failure and refreshes nothing', async ({ use, failure }) => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
    result.current.mutate(variables);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith(failure);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  interface ParseCase {
    name: string;
    raw: Record<string, unknown>;
    expected: Record<string, unknown>;
  }

  const payment = { id: 'pay-nested', client_secret: 'pi_nested_secret_x' };

  const PARSE_CASES: ParseCase[] = [
    {
      name: 'a bare response invents no money fields',
      raw: {},
      expected: {
        instance: {},
        payment_id: undefined,
        client_secret: undefined,
        payment_residual: undefined,
        payment_error: undefined,
        payment: undefined,
        off_session_charged: false,
        off_session_charge_residual: undefined,
        recurring_paused: false,
        recurring_status: undefined,
        recurring_config: undefined,
      },
    },
    {
      name: 'top-level payment_id and client_secret win over the nested payment',
      raw: {
        instance: { id: 'i-9' },
        payment_id: 'pay-top',
        client_secret: 'pi_top_secret_x',
        payment,
        payment_residual: 'requires_action',
        payment_error: 'card declined',
        off_session_charged: true,
        off_session_charge_residual: 'needs_customer',
        recurring_paused: true,
        recurring_status: 'paused',
        recurring_config: { id: 'rc-1' },
      },
      expected: {
        instance: { id: 'i-9' },
        payment_id: 'pay-top',
        client_secret: 'pi_top_secret_x',
        payment_residual: 'requires_action',
        payment_error: 'card declined',
        payment,
        off_session_charged: true,
        off_session_charge_residual: 'needs_customer',
        recurring_paused: true,
        recurring_status: 'paused',
        recurring_config: { id: 'rc-1' },
      },
    },
    {
      name: 'nested payment supplies id and secret when the top level has none',
      raw: { instance: { id: 'i-9' }, payment_id: '', payment },
      expected: {
        instance: { id: 'i-9' },
        payment_id: 'pay-nested',
        client_secret: 'pi_nested_secret_x',
        payment,
      },
    },
    {
      name: 'wrongly typed fields are dropped rather than coerced',
      raw: {
        instance: { id: 'i-9' },
        payment_id: 42,
        client_secret: 7,
        payment: { id: '', client_secret: 99 },
        payment_residual: 1,
        payment_error: false,
        off_session_charged: 'true',
        off_session_charge_residual: {},
        recurring_paused: 1,
        recurring_status: null,
      },
      expected: {
        payment_id: undefined,
        client_secret: undefined,
        payment_residual: undefined,
        payment_error: undefined,
        off_session_charged: false,
        off_session_charge_residual: undefined,
        recurring_paused: false,
        recurring_status: undefined,
      },
    },
  ];

  it.each(PARSE_CASES)('$name', async ({ raw, expected }) => {
    vi.mocked(api.post).mockResolvedValueOnce(raw);

    const { result } = renderHook(() => useApproveRecurringInstance(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(variables);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // toMatchObject treats an expected `undefined` as "absent or undefined",
    // which is exactly the contract: the field must not carry a value.
    const data: Record<string, unknown> = { ...result.current.data };
    expect(data).toMatchObject(expected);
    const leaked = Object.entries(expected)
      .filter(([, value]) => value === undefined)
      .filter(([key]) => data[key] !== undefined)
      .map(([key]) => key);
    expect(leaked).toEqual([]);
  });
});

describe('useCreateVisitPayment', () => {
  it('creates a payment for the server amount with a per-visit idempotency key', async () => {
    const created = { id: 'pay-1', client_secret: 'pi_1_secret_x' };
    vi.mocked(api.post).mockResolvedValueOnce(created);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateVisitPayment(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      contractId: 'c-1',
      amountCents: 8000,
      instanceId: 'i-1',
      providerId: 'prov-1',
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/payments',
      {
        contract_id: 'c-1',
        amount_cents: 8000,
        recurring_instance_id: 'i-1',
        provider_id: 'prov-1',
      },
      { 'Idempotency-Key': 'create-payment:c-1:8000:i-1' },
    );
    expect(result.current.data).toEqual(created);
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([['payments']]);
    // The sticky key survives until capture so a retry replays the same intent.
    expect(vi.mocked(clearIdempotencyKey)).not.toHaveBeenCalled();
  });

  it.each([0, -500])('refuses to charge a visit with amount %d without calling the API', async (amountCents) => {
    const { result } = renderHook(() => useCreateVisitPayment(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ contractId: 'c-1', amountCents, instanceId: 'i-1' });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('This visit has no server amount to charge.');
  });

  it('rewrites raw cents in a gateway rejection', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(400, JSON.stringify({ error: 'amount exceeds cap of 50000 cents' })),
    );

    const { result } = renderHook(() => useCreateVisitPayment(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ contractId: 'c-1', amountCents: 60000, instanceId: 'i-1' });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('amount exceeds cap of $500.00');
  });

  it('clearVisitPaymentIdempotency clears exactly the create key', () => {
    clearVisitPaymentIdempotency('c-1', 8000, 'i-1');

    expect(vi.mocked(clearIdempotencyKey)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearIdempotencyKey)).toHaveBeenCalledWith('create-payment:c-1:8000:i-1');
  });
});

describe('useProcessVisitPayment', () => {
  it('captures with an empty payment method and refreshes payments + recurring', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'pay-1', status: 'escrow' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useProcessVisitPayment(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('pay-1');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/payments/pay-1/process',
      { payment_method_id: '' },
      { 'Idempotency-Key': 'process-payment:pay-1' },
    );
    expect(vi.mocked(clearIdempotencyKey)).toHaveBeenCalledWith('process-payment:pay-1');
    expect(toastSuccess).toHaveBeenCalledWith('Visit paid — funds held in escrow');
    expect(invalidateSpy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ['payments'],
      ['payment', 'pay-1'],
      ['recurring'],
    ]);
  });

  it('keeps the sticky key when capture fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce('not an error object');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useProcessVisitPayment(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('pay-1');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toastError).toHaveBeenCalledWith('Could not capture visit payment');
    expect(vi.mocked(clearIdempotencyKey)).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('instance helpers with a missing status', () => {
  const noStatus = { id: 'i-0' };

  it('treats a visit with no status as neither completable, approvable nor payable', () => {
    expect(isRecurringInstanceCompletable(noStatus)).toBe(false);
    expect(isRecurringInstanceApprovable(noStatus)).toBe(false);
    expect(isRecurringInstancePayable({ ...noStatus, amount_cents: 5000, auto_approved: true })).toBe(
      false,
    );
  });

  it('a completed, approved visit with no amount is not payable', () => {
    expect(
      isRecurringInstancePayable({ id: 'i-1', status: 'completed', auto_approved: true }),
    ).toBe(false);
  });

  it('matches status case-insensitively', () => {
    expect(isRecurringInstanceCompletable({ id: 'i-2', status: 'IN_PROGRESS' })).toBe(true);
    expect(isRecurringInstanceApprovable({ id: 'i-2', status: 'Completed' })).toBe(true);
  });

  it('labels a missing status as Unknown', () => {
    expect(formatRecurringStatus(undefined)).toBe('Unknown');
  });
});
