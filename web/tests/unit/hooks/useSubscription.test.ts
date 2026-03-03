import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useTiers,
  useSubscription,
  useCreateSubscription,
  useCancelSubscription,
  useChangeTier,
  useUsage,
  useInvoices,
} from '@/hooks/useSubscription';
import type {
  Invoice,
  Subscription,
  SubscriptionTier,
  SubscriptionUsage,
} from '@/types';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
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
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const mockTier: SubscriptionTier = {
  id: 'tier-1',
  name: 'Pro',
  slug: 'pro',
  monthly_price_cents: 2999,
  annual_price_cents: 29990,
  fee_discount_percentage: 10,
  max_active_bids: 20,
  max_service_categories: 10,
  portfolio_image_limit: 50,
  featured_placement: true,
  analytics_access: true,
  priority_support: true,
  verified_badge_boost: true,
  instant_enabled: true,
  sort_order: 2,
};

const mockSubscription: Subscription = {
  id: 'sub-1',
  user_id: 'user-1',
  tier_id: 'tier-1',
  tier: mockTier,
  status: 'active',
  billing_interval: 'monthly',
  current_price_cents: 2999,
  current_period_start: '2026-03-01T00:00:00Z',
  current_period_end: '2026-04-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
};

const mockUsage: SubscriptionUsage = {
  active_bids: 5,
  max_active_bids: 20,
  service_categories: 3,
  max_service_categories: 10,
  portfolio_images: 12,
  max_portfolio_images: 50,
  current_fee_percentage: 8,
};

const mockInvoice: Invoice = {
  id: 'inv-1',
  subscription_id: 'sub-1',
  stripe_invoice_id: 'in_test123',
  amount_cents: 2999,
  status: 'paid',
  pdf_url: 'https://stripe.com/invoice.pdf',
  period_start: '2026-02-01T00:00:00Z',
  period_end: '2026-03-01T00:00:00Z',
  paid_at: '2026-02-01T00:00:05Z',
};

describe('useTiers', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches subscription tiers', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ tiers: [mockTier] });

    const { result } = renderHook(() => useTiers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.tiers).toHaveLength(1);
    expect(result.current.data?.tiers[0]?.name).toBe('Pro');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/subscriptions/tiers',
    );
  });

  it('starts in loading state', () => {
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useTiers(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useTiers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useSubscription', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches the current subscription', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      subscription: mockSubscription,
    });

    const { result } = renderHook(() => useSubscription(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.subscription.id).toBe('sub-1');
    expect(result.current.data?.subscription.status).toBe('active');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/subscriptions/me',
    );
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useSubscription(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCreateSubscription', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('creates a subscription and invalidates queries', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      subscription: mockSubscription,
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateSubscription(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      tier_id: 'tier-1',
      billing_interval: 'monthly',
      payment_method_id: 'pm_test123',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe('sub-1');
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/api/v1/subscriptions',
      {
        tier_id: 'tier-1',
        billing_interval: 'monthly',
        payment_method_id: 'pm_test123',
      },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['subscription'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['subscription-usage'],
    });
  });

  it('handles creation error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new Error('Payment failed'),
    );

    const { result } = renderHook(() => useCreateSubscription(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      tier_id: 'tier-1',
      billing_interval: 'monthly',
      payment_method_id: 'pm_bad',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCancelSubscription', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('cancels a subscription and invalidates queries', async () => {
    const cancelledSub = { ...mockSubscription, status: 'cancelled' as const };
    vi.mocked(api.delete).mockResolvedValueOnce({
      subscription: cancelledSub,
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCancelSubscription(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      reason: 'No longer needed',
      cancel_immediately: false,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.subscription.status).toBe('cancelled');
    expect(vi.mocked(api.delete)).toHaveBeenCalledWith(
      '/api/v1/subscriptions/me',
      { reason: 'No longer needed', cancel_immediately: false },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['subscription'],
    });
  });

  it('handles cancellation error', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(
      new Error('Cannot cancel during trial'),
    );

    const { result } = renderHook(() => useCancelSubscription(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      reason: 'Testing',
      cancel_immediately: true,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useChangeTier', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('changes the subscription tier', async () => {
    const upgradedSub = { ...mockSubscription, tier_id: 'tier-2' };
    vi.mocked(api.patch).mockResolvedValueOnce({
      subscription: upgradedSub,
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useChangeTier(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      new_tier_id: 'tier-2',
      billing_interval: 'annual',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.tier_id).toBe('tier-2');
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      '/api/v1/subscriptions/me/tier',
      { new_tier_id: 'tier-2', billing_interval: 'annual' },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['subscription'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['subscription-usage'],
    });
  });

  it('handles tier change error', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(
      new Error('Downgrade not allowed'),
    );

    const { result } = renderHook(() => useChangeTier(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      new_tier_id: 'tier-free',
      billing_interval: 'monthly',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUsage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches subscription usage data', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockUsage);

    const { result } = renderHook(() => useUsage(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.active_bids).toBe(5);
    expect(result.current.data?.max_active_bids).toBe(20);
    expect(result.current.data?.current_fee_percentage).toBe(8);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/subscriptions/me/usage',
    );
  });

  it('starts in loading state', () => {
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useUsage(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Unauthorized'));

    const { result } = renderHook(() => useUsage(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useInvoices', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches subscription invoices', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      invoices: [mockInvoice],
    });

    const { result } = renderHook(() => useInvoices(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.invoices).toHaveLength(1);
    expect(result.current.data?.invoices[0]?.amount_cents).toBe(2999);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/subscriptions/me/invoices',
    );
  });

  it('handles empty invoice list', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ invoices: [] });

    const { result } = renderHook(() => useInvoices(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.invoices).toHaveLength(0);
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useInvoices(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
