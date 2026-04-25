// Tests for the pricing page — exercises overview loading/error/empty/populated
// branches, category-detail navigation, and ZIP-code filter behavior.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../dashboard/_helpers';

const overviewState: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const categoryState: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/pricing',
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

vi.mock('@/components/maps/PriceHeatMap', () => ({
  PriceHeatMap: () => createElement('div', { 'data-testid': 'price-heatmap' }),
}));

vi.mock('@/hooks/usePricing', () => ({
  usePricingOverview: () => overviewState,
  usePricingByCategory: () => categoryState,
}));

// Stub IntersectionObserver — jsdom doesn't ship one. The page's useInView
// triggers fade-in animations; without a stub the constructor throws.
beforeEach(() => {
  globalThis.IntersectionObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  overviewState.data = undefined;
  overviewState.isLoading = false;
  overviewState.isError = false;
  categoryState.data = undefined;
  categoryState.isLoading = false;
  categoryState.isError = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

const { default: PricingPage } = await import('@/app/(public)/pricing/page');

const plumbing = {
  category_slug: 'plumbing',
  category_name: 'Plumbing',
  avg_median_cents: 25000,
  total_jobs: 12,
  avg_savings_cents: 8000,
};
const electrical = {
  category_slug: 'electrical',
  category_name: 'Electrical',
  avg_median_cents: 30000,
  total_jobs: 1,
  avg_savings_cents: null,
};

describe('PricingPage', () => {
  it('renders the hero, ZIP search, and heat map', () => {
    overviewState.data = { categories: [plumbing] };
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(screen.getByLabelText(/filter by zip code/i)).toBeDefined();
    expect(screen.getByTestId('price-heatmap')).toBeDefined();
  });

  it('renders loading skeletons in the overview while loading', () => {
    overviewState.isLoading = true;
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByLabelText(/loading service categories/i)).toBeDefined();
  });

  it('renders error message when overview fails to load', () => {
    overviewState.isError = true;
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByText(/failed to load pricing data/i)).toBeDefined();
  });

  it('renders empty state when no categories returned', () => {
    overviewState.data = { categories: [] };
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByText(/no pricing data available yet/i)).toBeDefined();
  });

  it('renders one card per category in the overview', () => {
    overviewState.data = { categories: [plumbing, electrical] };
    render(withQueryClient(createElement(PricingPage)));
    expect(screen.getByRole('button', { name: /view pricing for plumbing/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /view pricing for electrical/i })).toBeDefined();
    expect(screen.getByText(/12 jobs/)).toBeDefined();
    expect(screen.getByText(/^1 job$/)).toBeDefined();
  });

  it('switches to detail view when a category card is clicked', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.data = {
      prices: [
        {
          category_slug: 'plumbing',
          zip_code: '98101',
          median_price_cents: 25000,
          p25_price_cents: 18000,
          p75_price_cents: 32000,
          min_price_cents: 12000,
          max_price_cents: 50000,
          completed_jobs: 6,
          avg_savings_cents: 4000,
        },
      ],
    };
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    expect(screen.getByRole('heading', { name: /plumbing\s*pricing/i })).toBeDefined();
    expect(screen.getByText('98101')).toBeDefined();
    expect(screen.getByRole('button', { name: /all categories/i })).toBeDefined();
  });

  it('returns to overview when "All categories" clicked', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.data = { prices: [] };
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    fireEvent.click(screen.getByRole('button', { name: /all categories/i }));
    expect(screen.getByRole('button', { name: /view pricing for plumbing/i })).toBeDefined();
  });

  it('shows category-detail empty state when no rows for selected category', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.data = { prices: [] };
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    expect(screen.getByText(/no pricing data available for this category/i)).toBeDefined();
  });

  it('shows category-detail error state when detail fetch fails', () => {
    overviewState.data = { categories: [plumbing] };
    categoryState.isError = true;
    render(withQueryClient(createElement(PricingPage)));
    fireEvent.click(screen.getByRole('button', { name: /view pricing for plumbing/i }));
    expect(screen.getByText(/failed to load pricing breakdown/i)).toBeDefined();
  });

  it('applies and clears the ZIP filter', () => {
    overviewState.data = { categories: [plumbing] };
    render(withQueryClient(createElement(PricingPage)));
    const input = screen.getByLabelText(/filter by zip code/i);
    fireEvent.change(input, { target: { value: '98101' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    expect(screen.getByText(/showing prices for zip code/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /clear zip filter/i }));
    expect(screen.queryByText(/showing prices for zip code/i)).toBeNull();
  });
});
