// Smoke + branch tests for the customer/provider dashboard page.
// Covers role-based section rendering (customer-only, provider-only, both,
// neither), the customer onboarding checklist, and the StatCard / data-loaded
// branches inside the customer + provider dashboards.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const profileState: {
  data: { emailVerified: boolean } | undefined;
  isLoading: boolean;
} = { data: { emailVerified: true }, isLoading: false };

const customerJobsState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const contractsState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const paymentsState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const myBidsState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const customerSpendingState: { data: unknown } = { data: undefined };
const providerEarningsState: { data: unknown } = { data: undefined };

const authStoreState: {
  user: { id: string; displayName: string; roles: string[] } | null;
  isHydrating: boolean;
} = {
  user: { id: 'u1', displayName: 'Test User', roles: ['customer'] },
  isHydrating: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
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

vi.mock('@/components/dashboard/SavingsTracker', () => ({
  SavingsTracker: () => createElement('div', { 'data-testid': 'savings-tracker' }),
}));

// jsdom does not implement SVGGeometryElement.getTotalLength, which Sparkline
// relies on for its draw-on animation. A passthrough renderer is sufficient.
vi.mock('@/components/ui/sparkline', () => ({
  Sparkline: () => createElement('div', { 'data-testid': 'sparkline' }),
}));

// useCountUp is heavy + animation-driven; just return the input value.
vi.mock('@/hooks/useCountUp', () => ({
  useCountUp: (n: number) => n,
}));

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => profileState,
}));

vi.mock('@/hooks/useAnalytics', () => ({
  useCustomerSpending: () => customerSpendingState,
  useProviderEarnings: () => providerEarningsState,
}));

vi.mock('@/hooks/useBids', () => ({
  useMyBids: () => myBidsState,
}));

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => contractsState,
}));

vi.mock('@/hooks/useJobs', () => ({
  useCustomerJobs: () => customerJobsState,
}));

vi.mock('@/hooks/usePayments', () => ({
  usePayments: () => paymentsState,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: authStoreState.user,
      isHydrating: authStoreState.isHydrating,
    }),
}));

const { default: DashboardPage } = await import('@/app/(dashboard)/dashboard/page');

beforeEach(() => {
  profileState.data = { emailVerified: true };
  profileState.isLoading = false;
  customerJobsState.data = undefined;
  customerJobsState.isLoading = false;
  contractsState.data = undefined;
  contractsState.isLoading = false;
  paymentsState.data = undefined;
  paymentsState.isLoading = false;
  myBidsState.data = undefined;
  myBidsState.isLoading = false;
  customerSpendingState.data = undefined;
  providerEarningsState.data = undefined;
  authStoreState.user = { id: 'u1', displayName: 'Test User', roles: ['customer'] };
  authStoreState.isHydrating = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DashboardPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(DashboardPage)));
    expect(container).toBeTruthy();
  });

  it('renders a greeting heading', () => {
    const { container } = render(withQueryClient(createElement(DashboardPage)));
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toMatch(/Good (morning|afternoon|evening)/);
  });

  it('shows the hydrating skeleton while auth store is hydrating', () => {
    authStoreState.isHydrating = true;
    const { container } = render(withQueryClient(createElement(DashboardPage)));
    // No greeting heading rendered while hydrating.
    expect(container.querySelector('h1')).toBeNull();
  });

  it('renders the customer onboarding checklist when emailVerified=false and no jobs', () => {
    profileState.data = { emailVerified: false };
    customerJobsState.data = { jobs: [], pagination: { totalCount: 0 } };
    render(withQueryClient(createElement(DashboardPage)));
    expect(screen.getByText('Get started')).toBeDefined();
    expect(screen.getByText('Verify your email')).toBeDefined();
    expect(screen.getByText('Post your first job')).toBeDefined();
  });

  it('hides the onboarding checklist once a job exists and email verified', () => {
    customerJobsState.data = { jobs: [], pagination: { totalCount: 5 } };
    render(withQueryClient(createElement(DashboardPage)));
    expect(screen.queryByText('Get started')).toBeNull();
  });

  it('renders the customer dashboard with active jobs and bids stats', () => {
    customerJobsState.data = {
      jobs: [
        { id: 'j1', title: 'Sink', category_name: 'Plumbing', status: 'open', bid_count: 3 },
        { id: 'j2', title: 'Lawn', category_name: 'Lawn Care', status: 'in_progress', bid_count: 2 },
      ],
      pagination: { totalCount: 2 },
    };
    contractsState.data = { contracts: [], pagination: { totalCount: 1 } };
    paymentsState.data = {
      payments: [{ id: 'p1', amount_cents: 5000, provider_payout_cents: 4500 }],
    };
    render(withQueryClient(createElement(DashboardPage)));
    expect(screen.getByText('Active Jobs')).toBeDefined();
    expect(screen.getByText('Bids Received')).toBeDefined();
    expect(screen.getByText('Pending Actions')).toBeDefined();
    expect(screen.getByText('Total Spend')).toBeDefined();
    expect(screen.getByText('Sink')).toBeDefined();
  });

  it('shows the no-active-jobs message in the customer dashboard', () => {
    customerJobsState.data = { jobs: [], pagination: { totalCount: 0 } };
    render(withQueryClient(createElement(DashboardPage)));
    expect(screen.getByText(/No active jobs/i)).toBeDefined();
  });

  it('renders the provider dashboard for provider-only role', () => {
    authStoreState.user = {
      id: 'u2',
      displayName: 'Provider User',
      roles: ['provider'],
    };
    myBidsState.data = {
      bids: [
        { id: 'b1', amount_cents: 10000, status: 'pending', job_id: 'j1', created_at: '2026-04-01T00:00:00Z' },
        { id: 'b2', amount_cents: 7000, status: 'awarded', job_id: 'j2', created_at: '2026-04-02T00:00:00Z' },
      ],
      pagination: { totalCount: 2 },
    };
    contractsState.data = { contracts: [], pagination: { totalCount: 4 } };
    paymentsState.data = {
      payments: [{ id: 'p1', amount_cents: 8000, provider_payout_cents: 7000 }],
    };
    render(withQueryClient(createElement(DashboardPage)));
    // "Active Bids" appears twice (StatCard + Card heading); both are valid.
    expect(screen.getAllByText('Active Bids').length).toBeGreaterThan(0);
    expect(screen.getByText('Active Contracts')).toBeDefined();
    expect(screen.getByText('Total Earnings')).toBeDefined();
    expect(screen.getByText('Win Rate')).toBeDefined();
    // Browse Jobs quick action shows for providers.
    expect(screen.getByText('Browse Jobs')).toBeDefined();
  });

  it('shows the no-active-bids empty state in the provider dashboard', () => {
    authStoreState.user = {
      id: 'u2',
      displayName: 'Provider User',
      roles: ['provider'],
    };
    myBidsState.data = { bids: [], pagination: { totalCount: 0 } };
    render(withQueryClient(createElement(DashboardPage)));
    expect(screen.getByText(/No active bids/i)).toBeDefined();
  });

  it('renders both customer and provider sections when user has both roles', () => {
    authStoreState.user = {
      id: 'u3',
      displayName: 'Dual User',
      roles: ['customer', 'provider'],
    };
    customerJobsState.data = { jobs: [], pagination: { totalCount: 0 } };
    myBidsState.data = { bids: [], pagination: { totalCount: 0 } };
    render(withQueryClient(createElement(DashboardPage)));
    expect(screen.getByText('Customer Overview')).toBeDefined();
    expect(screen.getByText('Provider Overview')).toBeDefined();
  });

  it('falls back to the customer dashboard for users with no recognised role', () => {
    authStoreState.user = { id: 'u4', displayName: 'Other', roles: [] };
    render(withQueryClient(createElement(DashboardPage)));
    expect(screen.getByText('Active Jobs')).toBeDefined();
  });

  it('handles missing user display name without crashing', () => {
    authStoreState.user = { id: 'u5', displayName: '', roles: ['customer'] };
    const { container } = render(withQueryClient(createElement(DashboardPage)));
    expect(container.querySelector('h1')).toBeTruthy();
  });

  it('shows skeletons when customer jobs are loading', () => {
    customerJobsState.isLoading = true;
    contractsState.isLoading = true;
    paymentsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(DashboardPage)));
    // Loading branch renders Skeleton placeholders (bg-muted) inside cards
    // instead of the actual numeric values.
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('renders the customer Total Spend sparkline when spending data has data points', () => {
    customerSpendingState.data = {
      data_points: [
        { amount_cents: 1000, job_count: 1 },
        { amount_cents: 2000, job_count: 2 },
      ],
    };
    customerJobsState.data = {
      jobs: [],
      pagination: { totalCount: 0 },
    };
    contractsState.data = { contracts: [], pagination: { totalCount: 0 } };
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(DashboardPage)));
    // Total Spend card always rendered for customers; sparkline is supplementary.
    expect(screen.getByText('Total Spend')).toBeDefined();
  });

  it('shows the Verify your email checklist row as not completed when needed', () => {
    profileState.data = { emailVerified: false };
    customerJobsState.data = { jobs: [], pagination: { totalCount: 0 } };
    render(withQueryClient(createElement(DashboardPage)));
    // 1/3 complete (only "Create your account" checkmark).
    expect(screen.getByText(/1\/3 complete/)).toBeDefined();
  });

  it('shows skeletons in the provider Active Bids card when bids are loading', () => {
    authStoreState.user = {
      id: 'u-prov',
      displayName: 'Provider Loading',
      roles: ['provider'],
    };
    // bidsData is undefined and isLoading=true — drives the bidsLoading skeleton
    // branch (lines 483-488 in source).
    myBidsState.data = undefined;
    myBidsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(DashboardPage)));
    // The skeleton grid renders elements with the rounded-md class.
    const skeletons = container.querySelectorAll('.rounded-md');
    expect(skeletons.length).toBeGreaterThan(0);
    // Active Bids title should still render even while loading.
    expect(screen.getAllByText('Active Bids').length).toBeGreaterThan(0);
  });

  it('renders Good afternoon greeting between 12:00 and 16:59', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T13:00:00'));
    try {
      const { container } = render(withQueryClient(createElement(DashboardPage)));
      expect(container.querySelector('h1')?.textContent).toMatch(/Good afternoon/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders Good evening greeting at or after 17:00', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T20:30:00'));
    try {
      const { container } = render(withQueryClient(createElement(DashboardPage)));
      expect(container.querySelector('h1')?.textContent).toMatch(/Good evening/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the provider earnings sparklines when earnings data points exist', () => {
    authStoreState.user = {
      id: 'u-prov-2',
      displayName: 'Sparkline Provider',
      roles: ['provider'],
    };
    providerEarningsState.data = {
      data_points: [
        { earnings_cents: 1500, job_count: 1 },
        { earnings_cents: 3000, job_count: 2 },
        { earnings_cents: 4500, job_count: 3 },
      ],
    };
    myBidsState.data = { bids: [], pagination: { totalCount: 0 } };
    contractsState.data = { contracts: [], pagination: { totalCount: 0 } };
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(DashboardPage)));
    // Provider stat cards always render — sparkline mocked but exercised.
    expect(screen.getByText('Active Contracts')).toBeDefined();
    expect(screen.getByText('Total Earnings')).toBeDefined();
  });

  it('treats roles as empty array when the user object has no roles property', () => {
    // Casting handles the test fixture rather than the production type.
    authStoreState.user = {
      id: 'u-no-roles',
      displayName: 'No Roles',
    } as { id: string; displayName: string; roles: string[] };
    const { container } = render(withQueryClient(createElement(DashboardPage)));
    // Falls through to the Customer-only fallback dashboard.
    expect(container.querySelector('h1')).toBeTruthy();
  });

  it('uses default emailVerified=true when profile is undefined', () => {
    profileState.data = undefined;
    customerJobsState.data = { jobs: [], pagination: { totalCount: 0 } };
    render(withQueryClient(createElement(DashboardPage)));
    // 2/3 complete: account created + email verified default.
    expect(screen.getByText(/2\/3 complete/)).toBeDefined();
  });

  it('renders singular "1 bid" when a job has exactly one bid', () => {
    customerJobsState.data = {
      jobs: [
        { id: 'j-solo', title: 'Solo Bid Job', category_name: 'Plumbing', status: 'open', bid_count: 1 },
      ],
      pagination: { totalCount: 1 },
    };
    contractsState.data = { contracts: [], pagination: { totalCount: 0 } };
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(DashboardPage)));
    // singular form
    expect(screen.getByText(/^1 bid$/)).toBeDefined();
  });
});
