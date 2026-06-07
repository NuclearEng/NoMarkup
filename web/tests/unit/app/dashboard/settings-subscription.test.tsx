// Tests for the subscription settings page — exercises loading/error/empty/active
// states, usage bars, plan tier list, billing-interval toggle, view-mode toggle,
// invoice list, and cancel flow.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const subState: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const tiersState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const usageState: { data: unknown } = { data: undefined };
const invoicesState: { data: unknown } = { data: undefined };

const changeTierMutate = vi.fn(() => Promise.resolve({}));
const cancelMutate = vi.fn(() => Promise.resolve({}));
const createMutate = vi.fn(() => Promise.resolve({}));
const changeTierState = { isPending: false, isError: false, isSuccess: false };
const cancelState = { isPending: false, isError: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/subscription',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/payments/SubscriptionTierCard', () => ({
  SubscriptionTierCard: ({ tier, onSelect }: { tier: { id: string; name: string }; onSelect: (id: string) => void }) =>
    createElement(
      'button',
      {
        'data-testid': `tier-card-${tier.id}`,
        type: 'button',
        onClick: () => { onSelect(tier.id); },
      },
      tier.name,
    ),
}));

vi.mock('@/components/payments/SubscriptionTierComparison', () => ({
  SubscriptionTierComparison: () => createElement('div', { 'data-testid': 'tier-comparison' }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useCancelSubscription: () => ({
    mutateAsync: cancelMutate,
    isPending: cancelState.isPending,
    isError: cancelState.isError,
  }),
  useChangeTier: () => ({
    mutateAsync: changeTierMutate,
    isPending: changeTierState.isPending,
    isError: changeTierState.isError,
    isSuccess: changeTierState.isSuccess,
  }),
  useCreateSubscription: () => ({
    mutateAsync: createMutate,
    isPending: false,
    isError: false,
  }),
  useInvoices: () => invoicesState,
  useSubscription: () => subState,
  useTiers: () => tiersState,
  useUsage: () => usageState,
}));

const { default: SubscriptionPage } = await import(
  '@/app/(dashboard)/settings/subscription/page'
);

const baseSubscription = {
  id: 'sub_1',
  status: 'active',
  tier_id: 'tier_pro',
  tier: { name: 'Pro', sort_order: 2 },
  current_price_cents: 4900,
  billing_interval: 'monthly',
  current_period_start: '2025-04-01T00:00:00Z',
  current_period_end: '2025-05-01T00:00:00Z',
  trial_end: null,
  cancelled_at: null,
};

beforeEach(() => {
  subState.data = undefined;
  subState.isLoading = false;
  subState.isError = false;
  tiersState.data = undefined;
  tiersState.isLoading = false;
  usageState.data = undefined;
  invoicesState.data = undefined;
  changeTierState.isPending = false;
  changeTierState.isError = false;
  changeTierState.isSuccess = false;
  cancelState.isPending = false;
  cancelState.isError = false;
  changeTierMutate.mockClear();
  cancelMutate.mockClear();
  createMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SubscriptionPage', () => {
  it('renders loading skeletons while loading', () => {
    subState.isLoading = true;
    tiersState.isLoading = true;
    render(withQueryClient(createElement(SubscriptionPage)));
    // Loading branch renders header but no "Current Plan" / status content yet.
    expect(screen.getByRole('heading', { name: 'Subscription' })).toBeDefined();
    expect(screen.queryByText('Current Plan')).toBeNull();
    expect(screen.queryByText(/no active subscription/i)).toBeNull();
  });

  it('renders error banner when subscription fetch fails', () => {
    subState.isError = true;
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText(/failed to load subscription/i)).toBeDefined();
  });

  it('renders empty state when no subscription is active', () => {
    subState.data = { subscription: null };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText(/no active subscription/i)).toBeDefined();
  });

  it('renders active subscription details', () => {
    subState.data = { subscription: baseSubscription };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText('Pro')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('shows past-due status badge', () => {
    subState.data = { subscription: { ...baseSubscription, status: 'past_due' } };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText('Past Due')).toBeDefined();
  });

  it('renders usage bars when usage data present', () => {
    subState.data = { subscription: baseSubscription };
    usageState.data = {
      active_bids: 4,
      max_active_bids: 10,
      service_categories: 2,
      max_service_categories: 5,
      portfolio_images: 9,
      max_portfolio_images: 10,
      current_fee_percentage: 7,
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText('Active Bids')).toBeDefined();
    expect(screen.getByText('Service Categories')).toBeDefined();
    expect(screen.getByText('Portfolio Images')).toBeDefined();
    expect(screen.getByText('7%')).toBeDefined();
  });

  it('renders tier cards by default and switches to comparison view', () => {
    subState.data = { subscription: baseSubscription };
    tiersState.data = {
      tiers: [
        { id: 'tier_pro', name: 'Pro', sort_order: 2 },
        { id: 'tier_basic', name: 'Basic', sort_order: 1 },
      ],
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByTestId('tier-card-tier_pro')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /view as table/i }));
    expect(screen.getByTestId('tier-comparison')).toBeDefined();
  });

  it('triggers change-tier mutation when a tier card is selected', () => {
    subState.data = { subscription: baseSubscription };
    tiersState.data = {
      tiers: [{ id: 'tier_basic', name: 'Basic', sort_order: 1 }],
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    fireEvent.click(screen.getByTestId('tier-card-tier_basic'));
    expect(changeTierMutate).toHaveBeenCalledWith({
      new_tier_id: 'tier_basic',
      billing_interval: 'monthly',
    });
  });

  it('shows error banner when changeTier mutation errors', () => {
    subState.data = { subscription: baseSubscription };
    tiersState.data = { tiers: [{ id: 'tier_basic', name: 'Basic', sort_order: 1 }] };
    changeTierState.isError = true;
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText(/failed to change plan/i)).toBeDefined();
  });

  it('renders invoice list rows', () => {
    subState.data = { subscription: baseSubscription };
    invoicesState.data = {
      invoices: [
        {
          id: 'inv_1',
          period_start: '2025-03-01T00:00:00Z',
          period_end: '2025-04-01T00:00:00Z',
          amount_cents: 4900,
          status: 'paid',
          pdf_url: 'https://example.com/inv.pdf',
        },
      ],
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText('Invoice History')).toBeDefined();
    expect(screen.getByText('paid')).toBeDefined();
  });

  it('opens cancel confirmation when "Cancel Subscription" clicked', () => {
    subState.data = { subscription: baseSubscription };
    render(withQueryClient(createElement(SubscriptionPage)));
    fireEvent.click(screen.getByRole('button', { name: /^cancel subscription$/i }));
    expect(screen.getByLabelText(/reason for cancelling/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /confirm cancellation/i })).toBeDefined();
  });

  it('calls cancel mutation with reason when confirmed', () => {
    subState.data = { subscription: baseSubscription };
    render(withQueryClient(createElement(SubscriptionPage)));
    fireEvent.click(screen.getByRole('button', { name: /^cancel subscription$/i }));
    fireEvent.change(screen.getByLabelText(/reason for cancelling/i), {
      target: { value: 'too expensive' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));
    expect(cancelMutate).toHaveBeenCalledWith({
      reason: 'too expensive',
      cancel_immediately: false,
    });
  });

  it('hides cancel-subscription card when subscription is already cancelled', () => {
    subState.data = {
      subscription: { ...baseSubscription, cancelled_at: '2025-04-15T00:00:00Z' },
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.queryByRole('button', { name: /^cancel subscription$/i })).toBeNull();
    expect(screen.getByText(/cancels on/i)).toBeDefined();
  });

  it('shows the trial-end line when subscription has a trial_end value', () => {
    subState.data = {
      subscription: {
        ...baseSubscription,
        status: 'trialing',
        trial_end: '2025-05-15T00:00:00Z',
      },
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText(/Trial ends:/i)).toBeDefined();
    expect(screen.getByText('Trial')).toBeDefined();
  });

  it('shows the trialing badge label', () => {
    subState.data = {
      subscription: { ...baseSubscription, status: 'trialing' },
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText('Trial')).toBeDefined();
  });

  it('shows the cancelled badge label', () => {
    subState.data = {
      subscription: { ...baseSubscription, status: 'cancelled' },
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText('Cancelled')).toBeDefined();
  });

  it('shows the expired badge label', () => {
    subState.data = {
      subscription: { ...baseSubscription, status: 'expired' },
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText('Expired')).toBeDefined();
  });

  it('renders raw status as label and outline variant for unknown statuses', () => {
    subState.data = {
      subscription: { ...baseSubscription, status: 'unknown_state' },
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText('unknown_state')).toBeDefined();
  });

  it('shows annual billing label when subscription billing_interval is annual', () => {
    subState.data = {
      subscription: { ...baseSubscription, billing_interval: 'annual' },
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText(/\/year/)).toBeDefined();
  });

  it('shows the success banner after a successful tier change', () => {
    subState.data = { subscription: baseSubscription };
    tiersState.data = { tiers: [{ id: 'tier_basic', name: 'Basic', sort_order: 1 }] };
    changeTierState.isSuccess = true;
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText(/Plan changed successfully/i)).toBeDefined();
  });

  it('shows the cancel error banner when the cancel mutation errors', () => {
    subState.data = { subscription: baseSubscription };
    cancelState.isError = true;
    render(withQueryClient(createElement(SubscriptionPage)));
    fireEvent.click(screen.getByRole('button', { name: /^cancel subscription$/i }));
    expect(screen.getByText(/Failed to cancel subscription/i)).toBeDefined();
  });

  it('shows pending state ("Cancelling...") on the confirm button while cancelSubscription is pending', () => {
    subState.data = { subscription: baseSubscription };
    cancelState.isPending = true;
    render(withQueryClient(createElement(SubscriptionPage)));
    fireEvent.click(screen.getByRole('button', { name: /^cancel subscription$/i }));
    expect(screen.getByRole('button', { name: /^cancelling\.\.\./i })).toBeDefined();
  });

  it('closes the cancel confirmation when "Keep Subscription" is clicked', () => {
    subState.data = { subscription: baseSubscription };
    render(withQueryClient(createElement(SubscriptionPage)));
    fireEvent.click(screen.getByRole('button', { name: /^cancel subscription$/i }));
    expect(screen.getByLabelText(/reason for cancelling/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /keep subscription/i }));
    expect(screen.queryByLabelText(/reason for cancelling/i)).toBeNull();
  });

  it('renders an invoice without a download link when pdf_url is missing', () => {
    subState.data = { subscription: baseSubscription };
    invoicesState.data = {
      invoices: [
        {
          id: 'inv_1',
          period_start: '2025-03-01T00:00:00Z',
          period_end: '2025-04-01T00:00:00Z',
          amount_cents: 4900,
          status: 'open',
          pdf_url: null,
        },
      ],
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    expect(screen.getByText('Invoice History')).toBeDefined();
    // No download link rendered since pdf_url is null
    expect(screen.queryByRole('link', { name: /download invoice/i })).toBeNull();
  });

  it('starts a new subscription when a tier is selected and there is no current subscription', () => {
    subState.data = { subscription: null };
    tiersState.data = {
      tiers: [{ id: 'tier_basic', name: 'Basic', sort_order: 1 }],
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    fireEvent.click(screen.getByTestId('tier-card-tier_basic'));
    // No active subscription → create one, don't change tier.
    expect(changeTierMutate).not.toHaveBeenCalled();
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ tier_id: 'tier_basic' }),
    );
  });

  it('switches the billing interval to annual when the Annual tab is clicked', async () => {
    const user = userEvent.setup();
    subState.data = { subscription: baseSubscription };
    tiersState.data = {
      tiers: [{ id: 'tier_basic', name: 'Basic', sort_order: 1 }],
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    await user.click(screen.getByRole('tab', { name: /Annual/i }));
    await user.click(screen.getByTestId('tier-card-tier_basic'));
    expect(changeTierMutate).toHaveBeenCalledWith({
      new_tier_id: 'tier_basic',
      billing_interval: 'annual',
    });
  });

  it('switches back to cards view after toggling to table', () => {
    subState.data = { subscription: baseSubscription };
    tiersState.data = {
      tiers: [{ id: 'tier_basic', name: 'Basic', sort_order: 1 }],
    };
    render(withQueryClient(createElement(SubscriptionPage)));
    fireEvent.click(screen.getByRole('button', { name: /view as table/i }));
    expect(screen.getByTestId('tier-comparison')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /view as cards/i }));
    expect(screen.getByTestId('tier-card-tier_basic')).toBeDefined();
  });
});
