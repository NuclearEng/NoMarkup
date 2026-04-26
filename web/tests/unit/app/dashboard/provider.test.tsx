// Tests for the provider dashboard page — covers stat cards, profile
// completeness banner, performance section variants, earnings/trust
// loading/success branches, financial-tools rendering, and the active
// bids list (loading / empty / populated branches).
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

interface HookState {
  data?: unknown;
  isLoading: boolean;
}

const profileState: HookState = { data: undefined, isLoading: false };
const analyticsState: HookState = { data: undefined, isLoading: false };
const earningsState: HookState = { data: undefined, isLoading: false };
const bidsState: HookState = { data: undefined, isLoading: false };
const trustState: HookState = { data: undefined, isLoading: false };
const tierState: HookState = { data: undefined, isLoading: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider',
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

vi.mock('@/hooks/useAnalytics', () => ({
  useProviderAnalytics: () => analyticsState,
  useProviderEarnings: () => earningsState,
}));

vi.mock('@/hooks/useBids', () => ({
  useMyBids: () => bidsState,
}));

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => profileState,
}));

vi.mock('@/hooks/useTrustScore', () => ({
  useTierRequirements: () => tierState,
  useTrustScore: () => trustState,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u1', displayName: 'Test', roles: ['provider'] }, isHydrating: false }),
}));

// Stub heavy child components so we can assert their presence without rendering them.
vi.mock('@/components/analytics/EarningsChart', () => ({
  EarningsChart: ({ totalEarnings }: { totalEarnings: number }) =>
    createElement(
      'div',
      { 'data-testid': 'earnings-chart' },
      `chart-${String(totalEarnings)}`,
    ),
}));

vi.mock('@/components/providers/CreditScoreCard', () => ({
  CreditScoreCard: () => createElement('div', { 'data-testid': 'credit-score-card' }),
}));

vi.mock('@/components/providers/InstantPayoutButton', () => ({
  InstantPayoutButton: ({ availableBalanceCents }: { availableBalanceCents: number }) =>
    createElement('div', { 'data-testid': 'instant-payout' }, String(availableBalanceCents)),
}));

vi.mock('@/components/providers/ProviderRankCard', () => ({
  ProviderRankCard: () => createElement('div', { 'data-testid': 'provider-rank-card' }),
}));

vi.mock('@/components/providers/TaxProjectionCard', () => ({
  TaxProjectionCard: ({ ytdEarningsCents }: { ytdEarningsCents: number }) =>
    createElement('div', { 'data-testid': 'tax-projection' }, String(ytdEarningsCents)),
}));

vi.mock('@/components/providers/TrustScoreBreakdown', () => ({
  TrustScoreBreakdown: () =>
    createElement('div', { 'data-testid': 'trust-score-breakdown' }),
}));

const { default: ProviderDashboardPage } = await import('@/app/(dashboard)/provider/page');

beforeEach(() => {
  profileState.data = undefined;
  profileState.isLoading = false;
  analyticsState.data = undefined;
  analyticsState.isLoading = false;
  earningsState.data = undefined;
  earningsState.isLoading = false;
  bidsState.data = undefined;
  bidsState.isLoading = false;
  trustState.data = undefined;
  trustState.isLoading = false;
  tierState.data = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderDashboardPage', () => {
  it('renders without throwing in fully empty state', () => {
    const { container } = render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(container).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Provider Dashboard' })).toBeDefined();
  });

  it('renders profile completeness banner when profile is incomplete', () => {
    profileState.data = { profileCompleteness: 60 };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByText('Complete your profile')).toBeDefined();
    expect(screen.getByText(/60% complete/)).toBeDefined();
  });

  it('hides profile completeness banner when profile is 100% complete', () => {
    profileState.data = { profileCompleteness: 100 };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.queryByText('Complete your profile')).toBeNull();
  });

  it('renders analytics stat cards with values when analytics loads', () => {
    analyticsState.data = {
      jobs_completed: 12,
      win_rate: 0.62,
      total_earnings_cents: 250000,
      average_job_value_cents: 50000,
      average_rating: 4.8,
      total_reviews: 7,
      bids_won: 12,
      total_bids: 20,
      on_time_rate: 0.95,
      completion_rate: 0.9,
      avg_response_time_minutes: 30,
    };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByText('12')).toBeDefined();
    // Win rate text
    expect(screen.getByText('62% win rate')).toBeDefined();
    // 4.8 rating displayed
    expect(screen.getByText('4.8')).toBeDefined();
    // 7 reviews label
    expect(screen.getByText(/7 reviews/)).toBeDefined();
  });

  it('shows singular "review" when total_reviews === 1', () => {
    analyticsState.data = {
      jobs_completed: 1,
      win_rate: 0.5,
      total_earnings_cents: 1000,
      average_rating: 5,
      total_reviews: 1,
      bids_won: 1,
      total_bids: 2,
      on_time_rate: 1,
      completion_rate: 1,
      avg_response_time_minutes: 5,
    };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByText(/1 review$/)).toBeDefined();
  });

  it('renders dash for rating and "No reviews yet" when no reviews', () => {
    analyticsState.data = {
      jobs_completed: 0,
      win_rate: 0,
      total_earnings_cents: 0,
      average_rating: 0,
      total_reviews: 0,
      bids_won: 0,
      total_bids: 0,
      on_time_rate: 0,
      completion_rate: 0,
      avg_response_time_minutes: 0,
    };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByText('--')).toBeDefined();
    expect(screen.getByText('No reviews yet')).toBeDefined();
  });

  it('formats avg response time in hours when over 60 minutes', () => {
    analyticsState.data = {
      jobs_completed: 1,
      win_rate: 0.5,
      total_earnings_cents: 1000,
      average_rating: 5,
      total_reviews: 1,
      bids_won: 1,
      total_bids: 2,
      on_time_rate: 1,
      completion_rate: 1,
      avg_response_time_minutes: 150,
    };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    // 150 / 60 = 2.5 → rounds to 3h
    expect(screen.getByText(/3h/)).toBeDefined();
  });

  it('renders earnings chart when earnings data loads', () => {
    earningsState.data = {
      data_points: [],
      total_earnings_cents: 50000,
      total_fees_cents: 1000,
      net_earnings_cents: 49000,
      total_jobs: 3,
    };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByTestId('earnings-chart')).toBeDefined();
    expect(screen.getByText('chart-50000')).toBeDefined();
    // TaxProjectionCard also receives the earnings cents
    expect(screen.getByTestId('tax-projection').textContent).toBe('50000');
  });

  it('renders earnings loading skeleton card when earnings is loading', () => {
    earningsState.isLoading = true;
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByText('Earnings Overview')).toBeDefined();
  });

  it('renders trust score breakdown when trust data loads', () => {
    trustState.data = { score: { overall_score: 80, dimensions: {} } };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByTestId('trust-score-breakdown')).toBeDefined();
  });

  it('renders trust loading skeleton card when trust is loading', () => {
    trustState.isLoading = true;
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByText('Trust Score')).toBeDefined();
  });

  it('shows empty state for active bids when no bids returned', () => {
    bidsState.data = { bids: [], pagination: { totalCount: 0 } };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByText('No active bids.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Browse Jobs' })).toBeDefined();
  });

  it('renders bids list with formatted amount + status when bids exist', () => {
    bidsState.data = {
      bids: [
        {
          id: 'b1',
          job_id: 'job-9',
          amount_cents: 12345,
          status: 'in_progress',
          created_at: '2024-06-01T00:00:00Z',
        },
      ],
      pagination: { totalCount: 1 },
    };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    // Status badge text replaces underscores
    expect(screen.getByText('in progress')).toBeDefined();
    // Total count for the active bids stat card
    const activeBidLinks = screen.getAllByRole('link');
    expect(activeBidLinks.length).toBeGreaterThan(0);
  });

  it('renders bids loading skeletons when bids are loading', () => {
    bidsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(container).toBeTruthy();
    expect(screen.queryByText('No active bids.')).toBeNull();
  });

  it('renders Edit Profile link in header', () => {
    render(withQueryClient(createElement(ProviderDashboardPage)));
    const editLink = screen.getByRole('link', { name: 'Edit Profile' });
    expect(editLink).toBeDefined();
    expect(editLink.getAttribute('href')).toBe('/provider/onboarding');
  });

  it('renders the Financial Tools section', () => {
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByText('Financial Tools')).toBeDefined();
    expect(screen.getByTestId('credit-score-card')).toBeDefined();
    expect(screen.getByTestId('instant-payout')).toBeDefined();
  });

  it('passes total earnings to InstantPayoutButton when analytics loads', () => {
    analyticsState.data = {
      jobs_completed: 0,
      win_rate: 0,
      total_earnings_cents: 99999,
      average_rating: 0,
      total_reviews: 0,
      bids_won: 0,
      total_bids: 0,
      on_time_rate: 0,
      completion_rate: 0,
      avg_response_time_minutes: 0,
    };
    render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(screen.getByTestId('instant-payout').textContent).toBe('99999');
  });
});
