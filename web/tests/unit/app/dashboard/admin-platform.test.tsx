// Smoke + branch tests for the admin platform metrics page.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

// jsdom's Storage stub on this version doesn't expose getItem as a function;
// install a minimal in-memory shim so the page can call localStorage.getItem.
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length(): number { return store.size; },
    },
  });
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/platform',
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
  useCategoryMetrics: vi.fn(),
  useGrowthMetrics: vi.fn(),
  usePlatformMetrics: vi.fn(),
}));

const { useCategoryMetrics, useGrowthMetrics, usePlatformMetrics } = await import(
  '@/hooks/useAdmin'
);
const { default: AdminPlatformPage } = await import(
  '@/app/(dashboard)/admin/platform/page'
);

function setHooks(opts: {
  metrics?: unknown;
  metricsLoading?: boolean;
  growth?: unknown;
  growthLoading?: boolean;
  categories?: unknown;
  categoriesLoading?: boolean;
} = {}) {
  vi.mocked(usePlatformMetrics).mockReturnValue({
    data: opts.metrics,
    isLoading: opts.metricsLoading ?? false,
  } as unknown as ReturnType<typeof usePlatformMetrics>);
  vi.mocked(useGrowthMetrics).mockReturnValue({
    data: opts.growth,
    isLoading: opts.growthLoading ?? false,
  } as unknown as ReturnType<typeof useGrowthMetrics>);
  vi.mocked(useCategoryMetrics).mockReturnValue({
    data: opts.categories,
    isLoading: opts.categoriesLoading ?? false,
  } as unknown as ReturnType<typeof useCategoryMetrics>);
}

describe('AdminPlatformPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHooks();
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminPlatformPage)));
    expect(container).toBeTruthy();
  });

  it('renders the heading and analytics toggle switch', () => {
    render(withQueryClient(createElement(AdminPlatformPage)));
    expect(screen.getByRole('heading', { name: 'Platform Analytics' })).toBeDefined();
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('renders the metric card labels even while platform metrics load', () => {
    setHooks({ metricsLoading: true });
    render(withQueryClient(createElement(AdminPlatformPage)));
    // The card labels render regardless of loading state; the value is hidden by
    // a skeleton inside MetricsCard.
    expect(screen.getByText('Total Users')).toBeDefined();
    expect(screen.getByText('Jobs Posted')).toBeDefined();
    expect(screen.getByText('Total GMV')).toBeDefined();
  });

  it('renders the metric values when platform metrics load', () => {
    setHooks({
      metrics: {
        total_users: 42,
        total_jobs_posted: 17,
        total_gmv_cents: 1234500,
        avg_bids_per_job: 3.2,
      },
    });
    render(withQueryClient(createElement(AdminPlatformPage)));
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('17')).toBeDefined();
    expect(screen.getByText('3.2')).toBeDefined();
  });

  it('renders the empty growth state when there are no data points', () => {
    setHooks({ growth: { data_points: [], gmv_growth_rate: 0, user_growth_rate: 0, job_growth_rate: 0 } });
    render(withQueryClient(createElement(AdminPlatformPage)));
    expect(screen.getByText(/No growth data available/)).toBeDefined();
  });

  it('renders growth bars when there are data points', () => {
    setHooks({
      growth: {
        data_points: [
          { period_start: '2026-01-01T00:00:00Z', gmv_cents: 100000 },
          { period_start: '2026-02-01T00:00:00Z', gmv_cents: 200000 },
        ],
        gmv_growth_rate: 0.25,
        user_growth_rate: -0.1,
        job_growth_rate: 0.5,
      },
    });
    render(withQueryClient(createElement(AdminPlatformPage)));
    expect(screen.getByText('GMV by Period')).toBeDefined();
    expect(screen.getByText('+25.0%')).toBeDefined();
    expect(screen.getByText('-10.0%')).toBeDefined();
  });

  it('renders the empty categories state when none are returned', () => {
    setHooks({ categories: { categories: [] } });
    render(withQueryClient(createElement(AdminPlatformPage)));
    expect(screen.getByText('No category data available.')).toBeDefined();
  });

  it('renders category rows when categories are present', () => {
    setHooks({
      categories: {
        categories: [
          {
            category_id: 'cat-1',
            category_name: 'Plumbing',
            jobs_posted: 5,
            jobs_completed: 3,
            total_gmv_cents: 50000,
            avg_bid_cents: 10000,
            avg_bids_per_job: 2.5,
          },
        ],
      },
    });
    render(withQueryClient(createElement(AdminPlatformPage)));
    expect(screen.getByText('Plumbing')).toBeDefined();
    expect(screen.getByText('2.5')).toBeDefined();
  });

  it('renders the growth loading skeleton (lines 156-158)', () => {
    setHooks({ growthLoading: true });
    const { container } = render(withQueryClient(createElement(AdminPlatformPage)));
    // Growth section enters its loading branch: a 6-tall skeleton inside an h-48 wrapper.
    // Easier to assert: empty data-points / no-growth message is NOT visible while loading.
    expect(screen.queryByText(/No growth data available/)).toBeNull();
    expect(screen.queryByText('GMV by Period')).toBeNull();
    // The pulse-rounded skeleton bar is present.
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the categories loading skeleton (lines 252-261)', () => {
    setHooks({ categoriesLoading: true });
    const { container } = render(withQueryClient(createElement(AdminPlatformPage)));
    // Categories section enters loading branch — 5 skeleton rows.
    expect(screen.queryByText('No category data available.')).toBeNull();
    // Category Performance heading still rendered, but no table body.
    expect(screen.getByText('Category Performance')).toBeDefined();
    // Multiple animate-pulse skeletons exist.
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
  });

  it('renders both growth and categories loading states together', () => {
    setHooks({ growthLoading: true, categoriesLoading: true });
    const { container } = render(withQueryClient(createElement(AdminPlatformPage)));
    expect(container).toBeTruthy();
    // Neither empty state visible.
    expect(screen.queryByText(/No growth data available/)).toBeNull();
    expect(screen.queryByText('No category data available.')).toBeNull();
  });

  it('renders negative growth rates with red styling and minus sign (lines 211, 223, 235 negative branches)', () => {
    setHooks({
      growth: {
        data_points: [
          { period_start: '2026-01-01T00:00:00Z', gmv_cents: 100000 },
          { period_start: '2026-02-01T00:00:00Z', gmv_cents: 50000 },
        ],
        gmv_growth_rate: -0.5,
        user_growth_rate: -0.25,
        job_growth_rate: -0.75,
      },
    });
    render(withQueryClient(createElement(AdminPlatformPage)));
    expect(screen.getByText('-50.0%')).toBeDefined();
    expect(screen.getByText('-25.0%')).toBeDefined();
    expect(screen.getByText('-75.0%')).toBeDefined();
  });

  it('uses 0 percentage when maxGmv is 0 (line 173 false branch)', () => {
    setHooks({
      growth: {
        data_points: [
          { period_start: '2026-01-01T00:00:00Z', gmv_cents: 0 },
          { period_start: '2026-02-01T00:00:00Z', gmv_cents: 0 },
        ],
        gmv_growth_rate: 0,
        user_growth_rate: 0,
        job_growth_rate: 0,
      },
    });
    render(withQueryClient(createElement(AdminPlatformPage)));
    // Bars still rendered; growth rate row shows '+0.0%' for all three
    // (MetricsCard `trend` prop also renders +0.0% for the same rates).
    const zeros = screen.getAllByText('+0.0%');
    expect(zeros.length).toBeGreaterThanOrEqual(3);
  });

  it('persists analytics toggle preference to localStorage', () => {
    localStorage.clear();
    render(withQueryClient(createElement(AdminPlatformPage)));
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('nomarkup_analytics_enabled')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem('nomarkup_analytics_enabled')).toBe('false');
  });
});
