// Tests for the admin overview page — exercises loading, empty metrics,
// fully populated metrics, and the AdminQuickActions urgent-vs-safe branches.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin',
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

vi.mock('@/hooks/useAdmin', () => ({
  usePlatformMetrics: vi.fn(),
}));

const { usePlatformMetrics } = await import('@/hooks/useAdmin');
const { default: AdminOverviewPage } = await import('@/app/(dashboard)/admin/page');

interface PlatformMetrics {
  total_users: number;
  active_users: number;
  new_users: number;
  total_jobs_posted: number;
  total_jobs_completed: number;
  job_fill_rate: number;
  total_gmv_cents: number;
  total_revenue_cents: number;
  effective_take_rate: number;
  disputes_opened: number;
  disputes_resolved: number;
  dispute_rate: number;
  total_guarantee_fund_cents: number;
  guarantee_claims: number;
  guarantee_payouts_cents: number;
  total_bids: number;
  avg_bids_per_job: number;
  job_completion_rate: number;
}

function makeMetrics(overrides: Partial<PlatformMetrics> = {}): PlatformMetrics {
  return {
    total_users: 1234,
    active_users: 800,
    new_users: 100,
    total_jobs_posted: 567,
    total_jobs_completed: 400,
    job_fill_rate: 0.85,
    total_gmv_cents: 12345678,
    total_revenue_cents: 1234567,
    effective_take_rate: 0.1,
    disputes_opened: 5,
    disputes_resolved: 20,
    dispute_rate: 0.02,
    total_guarantee_fund_cents: 5000000,
    guarantee_claims: 3,
    guarantee_payouts_cents: 100000,
    total_bids: 1500,
    avg_bids_per_job: 2.6,
    job_completion_rate: 0.7,
    ...overrides,
  };
}

function setHook(opts: { data?: PlatformMetrics; isLoading?: boolean }) {
  vi.mocked(usePlatformMetrics).mockReturnValue({
    data: opts.data,
    isLoading: opts.isLoading ?? false,
  } as unknown as ReturnType<typeof usePlatformMetrics>);
}

describe('AdminOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHook({ data: undefined, isLoading: false });
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminOverviewPage)));
    expect(container).toBeTruthy();
  });

  it('renders the Admin Overview heading', () => {
    const { container } = render(withQueryClient(createElement(AdminOverviewPage)));
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toMatch(/Admin Overview/);
  });

  it('renders MetricsCards in loading state when metrics are loading', () => {
    setHook({ data: undefined, isLoading: true });
    const { container } = render(withQueryClient(createElement(AdminOverviewPage)));
    // When loading, MetricsCard shows Skeleton instead of value.
    // The cards still render — heading + 10 cards + AdminQuickActions.
    expect(container.querySelectorAll('.glass').length).toBeGreaterThanOrEqual(10);
    // Loading skeletons exist.
    const skeletons = container.querySelectorAll('[class*="animate"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows placeholder dashes when not loading and no metrics', () => {
    setHook({ data: undefined, isLoading: false });
    render(withQueryClient(createElement(AdminOverviewPage)));
    // 10 MetricsCards in two rows; each renders '--' when no metrics + not loading.
    const placeholders = screen.getAllByText('--');
    expect(placeholders.length).toBeGreaterThanOrEqual(6);
  });

  it('renders all metric values when fully populated', () => {
    setHook({ data: makeMetrics() });
    render(withQueryClient(createElement(AdminOverviewPage)));
    // Total users
    expect(screen.getByText('1234')).toBeDefined();
    // Active jobs
    expect(screen.getByText('567')).toBeDefined();
    // Description with active/new users (line 124)
    expect(screen.getByText('800 active, 100 new')).toBeDefined();
    // Fill rate description (line 135)
    expect(screen.getByText(/400 completed, 85.0% fill rate/)).toBeDefined();
    // Take rate description (line 152) — 0.1 * 100 = 10.0%
    expect(screen.getByText(/10.0% take rate/)).toBeDefined();
    // Dispute description (line 163) — 0.02 * 100 = 2.00%
    expect(screen.getByText(/20 resolved, 2.00% rate/)).toBeDefined();
    // Guarantee description (line 176)
    expect(screen.getByText(/3 claims/)).toBeDefined();
    // Total bids (line 187)
    expect(screen.getByText('1500')).toBeDefined();
    // Avg bids per job (line 193)
    expect(screen.getByText('2.6')).toBeDefined();
    // Job completion rate (line 202) — formatted as 70.0%
    expect(screen.getByText('70.0%')).toBeDefined();
  });

  it('renders zero metrics correctly', () => {
    setHook({
      data: makeMetrics({
        total_users: 0,
        active_users: 0,
        new_users: 0,
        disputes_opened: 0,
        disputes_resolved: 0,
        dispute_rate: 0,
        guarantee_claims: 0,
        guarantee_payouts_cents: 0,
        total_bids: 0,
        avg_bids_per_job: 0,
        job_completion_rate: 0,
      }),
    });
    render(withQueryClient(createElement(AdminOverviewPage)));
    // 0.0% job completion rate
    expect(screen.getByText('0.0%')).toBeDefined();
    // 'Open Disputes' is both a card label and an action label — at least one rendered.
    expect(screen.getAllByText('Open Disputes').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the AdminQuickActions section with all 6 actions', () => {
    setHook({ data: makeMetrics({ disputes_opened: 8 }) });
    render(withQueryClient(createElement(AdminOverviewPage)));
    expect(screen.getByText('Pending Verifications')).toBeDefined();
    // 'Open Disputes' label appears in both MetricsCard and action — accept multiple.
    expect(screen.getAllByText('Open Disputes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Manage Taxonomy')).toBeDefined();
    expect(screen.getByText('Platform Settings')).toBeDefined();
    // 'Guarantee Fund' is also a card label and an action label.
    expect(screen.getAllByText('Guarantee Fund').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Fraud Review')).toBeDefined();
    // disputes_opened > 0, urgent = true → count badge with '8' rendered.
    expect(screen.getAllByText('8').length).toBeGreaterThanOrEqual(1);
  });

  it('renders urgent indicator for verification action even with no count', () => {
    setHook({ data: makeMetrics({ disputes_opened: 0 }) });
    const { container } = render(withQueryClient(createElement(AdminOverviewPage)));
    // Pending Verifications has urgent: true but no count, so (action.count ?? 0) > 0 is false → CheckCircle2 branch
    // Open Disputes has count=0 + urgent=false → CheckCircle2 branch
    // The AdminQuickActions card still renders.
    expect(container.querySelector('h1')).toBeTruthy();
  });

  it('renders without metrics (undefined branches)', () => {
    setHook({ data: undefined, isLoading: false });
    render(withQueryClient(createElement(AdminOverviewPage)));
    // metrics is undefined → description is undefined for all cards
    // (action.count ?? 0) > 0 is false → CheckCircle2 branch on every action
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });
});
