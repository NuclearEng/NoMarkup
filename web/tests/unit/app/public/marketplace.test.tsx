// Marketplace index page — covers loading, error, empty, and success states.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../dashboard/_helpers';

const listingsState: {
  data:
    | {
        listings: { id: string; title: string }[];
        pagination: { totalCount: number; totalPages: number; hasNext: boolean };
      }
    | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = {
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/marketplace',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/marketplace/ListingCard', () => ({
  ListingCard: ({ listing }: { listing: { id: string; title: string } }) =>
    createElement('article', { 'data-testid': `listing-${listing.id}` }, listing.title),
}));

vi.mock('@/components/marketplace/ListingFilters', () => ({
  ListingFilters: ({
    onChange,
  }: {
    onChange: (next: Record<string, unknown>) => void;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'filters' },
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'apply-filter',
          onClick: () => {
            onChange({ query: 'sofa', page: 1, page_size: 12 });
          },
        },
        'Apply',
      ),
    ),
}));

vi.mock('@/hooks/useListings', () => ({
  useListings: () => listingsState,
}));

import MarketplacePage from '@/app/(public)/marketplace/page';

beforeEach(() => {
  listingsState.data = undefined;
  listingsState.isLoading = false;
  listingsState.isError = false;
  listingsState.refetch = vi.fn();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('MarketplacePage', () => {
  it('renders the page header', () => {
    listingsState.data = {
      listings: [],
      pagination: { totalCount: 0, totalPages: 0, hasNext: false },
    };
    render(withQueryClient(createElement(MarketplacePage)));
    expect(screen.getByText(/Goods/)).toBeDefined();
    expect(screen.getByText(/Marketplace/)).toBeDefined();
  });

  it('renders skeletons while loading', () => {
    listingsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(MarketplacePage)));
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the error empty state on isError', () => {
    listingsState.isError = true;
    render(withQueryClient(createElement(MarketplacePage)));
    expect(screen.getByText(/Failed to load listings/i)).toBeDefined();
  });

  it('clicking Retry on error invokes refetch', () => {
    const refetch = vi.fn();
    listingsState.isError = true;
    listingsState.refetch = refetch;
    render(withQueryClient(createElement(MarketplacePage)));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty state with no filters', () => {
    listingsState.data = {
      listings: [],
      pagination: { totalCount: 0, totalPages: 0, hasNext: false },
    };
    render(withQueryClient(createElement(MarketplacePage)));
    expect(screen.getByText(/No listings found/i)).toBeDefined();
  });

  it('renders listing cards when results exist', () => {
    listingsState.data = {
      listings: [
        { id: 'a', title: 'Sofa' },
        { id: 'b', title: 'Bike' },
      ],
      pagination: { totalCount: 2, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(MarketplacePage)));
    expect(screen.getByTestId('listing-a')).toBeDefined();
    expect(screen.getByTestId('listing-b')).toBeDefined();
  });

  it('renders Previous/Next pagination when totalPages > 1', () => {
    listingsState.data = {
      listings: [{ id: 'a', title: 'A' }],
      pagination: { totalCount: 24, totalPages: 2, hasNext: true },
    };
    render(withQueryClient(createElement(MarketplacePage)));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDefined();
  });

  it('toggles the mobile filters panel', () => {
    listingsState.data = {
      listings: [],
      pagination: { totalCount: 0, totalPages: 0, hasNext: false },
    };
    render(withQueryClient(createElement(MarketplacePage)));
    const toggle = screen.getByRole('button', { name: /Filters/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders the filters panel mocked component', () => {
    listingsState.data = {
      listings: [],
      pagination: { totalCount: 0, totalPages: 0, hasNext: false },
    };
    render(withQueryClient(createElement(MarketplacePage)));
    expect(screen.getByTestId('filters')).toBeDefined();
  });
});
