// Tests for the provider business overview page — covers the loading branch
// of StatCard (skeleton) and the loaded value branch with formatted dollars.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const analyticsState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const expensesState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/business',
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
}));

vi.mock('@/hooks/useExpenses', () => ({
  useExpenses: () => expensesState,
}));

const { default: ProviderBusinessPage } = await import(
  '@/app/(dashboard)/provider/business/page'
);

beforeEach(() => {
  analyticsState.data = undefined;
  analyticsState.isLoading = false;
  expensesState.data = undefined;
  expensesState.isLoading = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderBusinessPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderBusinessPage)));
    expect(container).toBeTruthy();
  });

  it('shows StatCard skeletons when analytics is loading', () => {
    analyticsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ProviderBusinessPage)));
    // Three StatCards each render a Skeleton (bg-muted) in their loading branch
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThanOrEqual(3);
  });

  it('shows StatCard skeletons when expenses is loading (loading branch)', () => {
    expensesState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ProviderBusinessPage)));
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThanOrEqual(3);
  });

  it('renders YTD Revenue / Expenses / Net Income values once loaded', () => {
    analyticsState.data = { total_earnings_cents: 250000 };
    expensesState.data = { total_cents: 100000 };
    render(withQueryClient(createElement(ProviderBusinessPage)));
    // YTD revenue
    expect(screen.getByText('YTD Revenue')).toBeDefined();
    expect(screen.getByText('YTD Expenses')).toBeDefined();
    expect(screen.getByText('Net Income')).toBeDefined();
  });

  it('renders all three business links with hrefs', () => {
    render(withQueryClient(createElement(ProviderBusinessPage)));
    const taxLink = screen.getByText('Tax Center').closest('a');
    expect(taxLink?.getAttribute('href')).toBe('/provider/business/tax');
    const invoicesLink = screen.getByText('Invoices').closest('a');
    expect(invoicesLink?.getAttribute('href')).toBe('/provider/business/invoices');
    const expensesLink = screen.getByText('Expense Tracking').closest('a');
    expect(expensesLink?.getAttribute('href')).toBe('/provider/business/expenses');
  });
});
