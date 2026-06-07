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
  useStripeOnboardingLink,
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
  idempotencyHeader: () => ({ 'Idempotency-Key': 'test-idem-key' }),
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
}));

const { api } = await import('@/lib/api');
const { toast } = await import('sonner');

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
  refund_amount_cents: 0,
  refund_reason: '',
  created_at: '2026-04-25T00:00:00Z',
};

const mockMethod: PaymentMethod = {
  id: 'pm-1',
  type: 'card',
  brand: 'visa',
  last_four: '4242',
  exp_month: 12,
  exp_year: 2030,
  is_default: false,
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
    const response: PaymentsResponse = {
      payments: [mockPayment],
      pagination: { page: 1, pageSize: 20, totalCount: 1, totalPages: 1, hasNext: false },
    };
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
      payment_method_id: 'pm-1',
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
      { 'Idempotency-Key': 'test-idem-key' },
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
      subtotal_cents: 50000,
      platform_fee_cents: 2500,
      guarantee_fee_cents: 1000,
      total_cents: 53500,
      provider_payout_cents: 46500,
      fee_percentage: 5,
      guarantee_percentage: 2,
      lead_gen_fee_cents: 0,
      lead_gen_percentage: 0,
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
      { 'Idempotency-Key': 'test-idem-key' },
    );
    expect(result.current.data?.payout_id).toBe('po_1');
  });

  it('invalidates the payments + analytics + earnings caches on success', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      payout_id: 'po_2',
      amount_cents: 1000,
      estimated_arrival: '2026-04-26T00:00:00Z',
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useInstantPayout(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(1000);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['provider-analytics'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['provider-earnings'] });
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Payout initiated — funds arriving within minutes',
    );
  });

  it('shows an error toast when the payout call fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useInstantPayout(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate(500);
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Instant payout failed — please try again',
    );
  });
});

describe('error toasts on mutation failures', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('useCreatePayment fires the failure toast on error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useCreatePayment(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({
      contract_id: 'c-1',
      milestone_id: '',
      amount_cents: 1000,
      payment_method_id: 'pm-1',
    });
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to create payment');
  });

  it('useProcessPayment fires the failure toast on error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useProcessPayment(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ paymentId: 'pmt-1', payment_method_id: 'pm-1' });
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Payment failed — please try again',
    );
  });

  it('useDeletePaymentMethod fires the failure toast on error', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useDeletePaymentMethod(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate('pm-1');
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Failed to remove payment method',
    );
  });

  it('useCreateSetupIntent fires the failure toast on error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useCreateSetupIntent(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Failed to initialize payment setup',
    );
  });

  it('useAddDevPaymentMethod fires the failure toast on error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useAddDevPaymentMethod(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030 });
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to add payment method');
  });

  it('useCreateStripeAccount fires the failure toast on error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useCreateStripeAccount(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to create Stripe account');
  });
});

describe('useStripeOnboardingLink', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = createTestQueryClient();
  });
  afterEach(() => { queryClient.clear(); });

  it('does not auto-fetch — only runs after refetch is invoked', () => {
    const { result } = renderHook(
      () => useStripeOnboardingLink({
        return_url: 'https://app.test/return',
        refresh_url: 'https://app.test/refresh',
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('normalizes onboarding_url to { url } when refetched', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      onboarding_url: 'https://stripe.test/onb/abc',
    });

    const { result } = renderHook(
      () => useStripeOnboardingLink({
        return_url: 'https://app.test/return',
        refresh_url: 'https://app.test/refresh',
      }),
      { wrapper: createWrapper(queryClient) },
    );
    const fetched = await result.current.refetch();

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/providers/me/stripe/onboarding?return_url=https%3A%2F%2Fapp.test%2Freturn&refresh_url=https%3A%2F%2Fapp.test%2Frefresh',
    );
    expect(fetched.data?.url).toBe('https://stripe.test/onb/abc');
  });
});
