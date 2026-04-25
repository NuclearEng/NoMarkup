// Tests for the analytics page — exercises customer vs provider role branches,
// loading/error/data states, and category breakdown rendering.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const authState: { user: { id: string; roles: string[] } | null } = {
  user: { id: 'u1', roles: ['customer'] },
};

const providerAnalyticsState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };
const providerEarningsState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const customerSpendingState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const refetchAnalytics = vi.fn();
const refetchSpending = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/analytics',
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

vi.mock('@/components/analytics/EarningsChart', () => ({
  EarningsChart: () => createElement('div', { 'data-testid': 'earnings-chart' }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: unknown; isHydrating: boolean }) => unknown) =>
    selector({ user: authState.user, isHydrating: false }),
}));

vi.mock('@/hooks/useAnalytics', () => ({
  useProviderAnalytics: () => ({
    data: providerAnalyticsState.data,
    isLoading: providerAnalyticsState.isLoading,
    isError: providerAnalyticsState.isError,
    refetch: refetchAnalytics,
  }),
  useProviderEarnings: () => ({
    data: providerEarningsState.data,
    isLoading: providerEarningsState.isLoading,
  }),
  useCustomerSpending: () => ({
    data: customerSpendingState.data,
    isLoading: customerSpendingState.isLoading,
    isError: customerSpendingState.isError,
    refetch: refetchSpending,
  }),
}));

const { default: AnalyticsPage } = await import('@/app/(dashboard)/analytics/page');

beforeEach(() => {
  authState.user = { id: 'u1', roles: ['customer'] };
  providerAnalyticsState.data = undefined;
  providerAnalyticsState.isLoading = false;
  providerAnalyticsState.isError = false;
  providerEarningsState.data = undefined;
  providerEarningsState.isLoading = false;
  customerSpendingState.data = undefined;
  customerSpendingState.isLoading = false;
  customerSpendingState.isError = false;
  refetchAnalytics.mockClear();
  refetchSpending.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AnalyticsPage', () => {
  it('renders customer copy and view for customer role', () => {
    render(withQueryClient(createElement(AnalyticsPage)));
    expect(screen.getByText(/track your spending/i)).toBeDefined();
  });

  it('renders provider copy and view for provider role', () => {
    authState.user = { id: 'u1', roles: ['provider'] };
    render(withQueryClient(createElement(AnalyticsPage)));
    expect(screen.getByText(/track your performance/i)).toBeDefined();
  });

  it('renders customer loading state when spending is loading', () => {
    customerSpendingState.isLoading = true;
    render(withQueryClient(createElement(AnalyticsPage)));
    // Loading state renders no metric labels.
    expect(screen.queryByText('Total Spent')).toBeNull();
  });

  it('renders customer error state with retry button', () => {
    customerSpendingState.isError = true;
    render(withQueryClient(createElement(AnalyticsPage)));
    expect(screen.getByText(/failed to load spending data/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
  });

  it('renders customer spending metrics and category breakdown', () => {
    customerSpendingState.data = {
      total_spent_cents: 250000,
      total_jobs: 5,
      average_job_cost_cents: 50000,
      total_savings_cents: 25000,
      data_points: [
        { period_start: '2025-03-01T00:00:00Z', amount_cents: 50000, job_count: 1 },
        { period_start: '2025-04-01T00:00:00Z', amount_cents: 100000, job_count: 2 },
      ],
      category_breakdown: [
        { category_id: 'c1', category_name: 'Plumbing', job_count: 3, total_spent_cents: 150000 },
      ],
    };
    render(withQueryClient(createElement(AnalyticsPage)));
    expect(screen.getAllByText('Total Spent').length).toBeGreaterThan(0);
    expect(screen.getByText('Spending Over Time')).toBeDefined();
    expect(screen.getByText('Spending by Category')).toBeDefined();
    expect(screen.getByText('Plumbing')).toBeDefined();
  });

  it('renders provider loading state', () => {
    authState.user = { id: 'u1', roles: ['provider'] };
    providerAnalyticsState.isLoading = true;
    render(withQueryClient(createElement(AnalyticsPage)));
    expect(screen.queryByText('Win Rate')).toBeNull();
  });

  it('renders provider error state', () => {
    authState.user = { id: 'u1', roles: ['provider'] };
    providerAnalyticsState.isError = true;
    render(withQueryClient(createElement(AnalyticsPage)));
    expect(screen.getByText(/failed to load analytics/i)).toBeDefined();
  });

  it('renders provider analytics metrics and category breakdown', () => {
    authState.user = { id: 'u1', roles: ['provider'] };
    providerAnalyticsState.data = {
      win_rate: 0.45,
      bids_won: 9,
      total_bids: 20,
      on_time_rate: 0.95,
      completion_rate: 0.9,
      jobs_completed: 9,
      average_rating: 4.7,
      total_reviews: 12,
      total_earnings_cents: 500000,
      average_job_value_cents: 55000,
      avg_response_time_minutes: 14,
      category_breakdown: [
        {
          category_id: 'c1',
          category_name: 'Electrical',
          jobs_completed: 5,
          total_earnings_cents: 250000,
          average_rating: 4.8,
        },
      ],
    };
    providerEarningsState.data = {
      data_points: [],
      total_earnings_cents: 500000,
      total_fees_cents: 25000,
      net_earnings_cents: 475000,
      total_jobs: 9,
    };
    render(withQueryClient(createElement(AnalyticsPage)));
    expect(screen.getByText('Win Rate')).toBeDefined();
    expect(screen.getByText('45%')).toBeDefined();
    expect(screen.getByText('Category Breakdown')).toBeDefined();
    expect(screen.getByText('Electrical')).toBeDefined();
    expect(screen.getByTestId('earnings-chart')).toBeDefined();
  });

  it('omits category breakdown card when no categories present', () => {
    authState.user = { id: 'u1', roles: ['provider'] };
    providerAnalyticsState.data = {
      win_rate: 0,
      bids_won: 0,
      total_bids: 0,
      on_time_rate: 0,
      completion_rate: 0,
      jobs_completed: 0,
      average_rating: 0,
      total_reviews: 0,
      total_earnings_cents: 0,
      average_job_value_cents: 0,
      avg_response_time_minutes: 0,
      category_breakdown: [],
    };
    render(withQueryClient(createElement(AnalyticsPage)));
    expect(screen.queryByText('Category Breakdown')).toBeNull();
  });
});
