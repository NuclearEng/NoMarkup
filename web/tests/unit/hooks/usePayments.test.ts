import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  usePayments,
  usePayment,
  useCreatePayment,
  useProcessPayment,
  usePaymentMethods,
  useDeletePaymentMethod,
  useCreateSetupIntent,
  useAddDevPaymentMethod,
  useCalculateFees,
  useStripeAccountStatus,
  useCreateStripeAccount,
  useInstantPayout,
} from '@/hooks/usePayments';
import type {
  Payment,
  PaymentMethod,
  PaymentsResponse,
  PaymentBreakdown,
  StripeAccountStatus,
} from '@/types';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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

const { api } = await import('@/lib/api');

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

const mockPayment: Payment = {
  id: 'pmt-1',
  contract_id: 'c-1',
  customer_id: 'cust-1',
  provider_id: 'prov-1',
  amount_cents: 50000,
  platform_fee_cents: 2500,
  guarantee_fee_cents: 1000,
  provider_payout_cents: 46500,
  status: 'pending',
  stripe_payment_intent_id: '',
  stripe_charge_id: '',
  stripe_transfer_id: '',
  stripe_refund_id: '',
  idempotency_key: 'idem-1',
  refund_amount_cents: 0,
  refund_reason: '',
  refunded_at: null,
  created_at: '2026-04-25T00:00:00Z',
  updated_at: '2026-04-25T00:00:00Z',
};

const mockMethod: PaymentMethod = {
  id: 'pm-1',
  type: 'card',
  brand: 'visa',
  last_four: '4242',
  exp_month: 12,
  exp_year: 2030,
};

describe('usePayments (list)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches payments with no params', async () => {
    const response: PaymentsResponse = { payments: [mockPayment], total: 1 };
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(() => usePayments(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.payments).toHaveLength(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/payments');
  });

  it('appends status + pagination params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ payments: [], total: 0 });

    const { result } = renderHook(
      () => usePayments({ status: 'released', page: 2, per_page: 25 }),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/payments?status=released&page=2&per_page=25',
    );
  });
});

describe('usePayment (single)', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('wraps the bare payment response in { payment }', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockPayment);
    const { result } = renderHook(() => usePayment('pmt-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.payment.id).toBe('pmt-1');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/payments/pmt-1');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => usePayment(''), {
      wrapper: createWrapper(queryClient),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreatePayment', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('posts the payment + invalidates payments cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockPayment);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreatePayment(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      contract_id: 'c-1',
      milestone_id: '',
      amount_cents: 50000,
      idempotency_key: 'idem-1',
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.id).toBe('pmt-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
  });
});

describe('useProcessPayment', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('processes payment + invalidates list AND single-payment caches', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ ...mockPayment, status: 'escrow' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useProcessPayment(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ paymentId: 'pmt-1', payment_method_id: 'pm-1' });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/payments/pmt-1/process',
      { payment_method_id: 'pm-1' },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payment', 'pmt-1'] });
  });
});

describe('usePaymentMethods', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('normalizes the gateway shape to { payment_methods }', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ methods: [mockMethod] });
    const { result } = renderHook(() => usePaymentMethods(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.payment_methods).toEqual([mockMethod]);
  });
});

describe('useDeletePaymentMethod', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('deletes by id and invalidates payment-methods cache', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeletePaymentMethod(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('pm-1');
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/api/v1/payments/methods/pm-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payment-methods'] });
  });
});

describe('useCreateSetupIntent', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('returns the client_secret from the gateway', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ client_secret: 'seti_xxx_secret_yyy' });
    const { result } = renderHook(() => useCreateSetupIntent(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.client_secret).toBe('seti_xxx_secret_yyy');
  });
});

describe('useAddDevPaymentMethod', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('posts dev card + invalidates payment-methods', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(mockMethod);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAddDevPaymentMethod(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      brand: 'visa',
      last_four: '4242',
      exp_month: 12,
      exp_year: 2030,
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payment-methods'] });
  });
});

describe('useCalculateFees', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('returns the fee breakdown', async () => {
    const breakdown: PaymentBreakdown = {
      amount_cents: 50000,
      platform_fee_cents: 2500,
      guarantee_fee_cents: 1000,
      provider_payout_cents: 46500,
    };
    vi.mocked(api.post).mockResolvedValueOnce(breakdown);

    const { result } = renderHook(() => useCalculateFees(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ amount_cents: 50000 });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.platform_fee_cents).toBe(2500);
  });
});

describe('useStripeAccountStatus + useCreateStripeAccount', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('fetches the account status', async () => {
    const status: StripeAccountStatus = {
      account_id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: [],
    };
    vi.mocked(api.get).mockResolvedValueOnce(status);

    const { result } = renderHook(() => useStripeAccountStatus(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.charges_enabled).toBe(true);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/stripe/status');
  });

  it('creates account + normalizes stripe_account_id → account_id', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ stripe_account_id: 'acct_42' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateStripeAccount(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(result.current.data?.account_id).toBe('acct_42');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['stripe-account-status'] });
  });
});

describe('useInstantPayout', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('posts the amount + returns payout details', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      payout_id: 'po_1',
      amount_cents: 25000,
      estimated_arrival: '2026-04-26T00:00:00Z',
    });

    const { result } = renderHook(() => useInstantPayout(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(25000);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/payments/instant-payout',
      { amount_cents: 25000 },
    );
    expect(result.current.data?.payout_id).toBe('po_1');
  });
});
