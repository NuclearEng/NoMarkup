// Marketplace browse — the page is now an async Server Component (server fetch
// of the default listing set) and all interactivity lives in
// ListingBrowseClient. These tests render the client island directly with a
// seeded `initialListings`, mirroring what the server passes in. Covers
// loading, error, empty, and success states.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../dashboard/_helpers';
import type { ListingsResponse } from '@/types';

const listingsState: {
  data: ListingsResponse | undefined;
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

vi.mock('@/components/marketplace/ScoreboardCard', () => ({
  ScoreboardCard: ({ listing }: { listing: { id: string; title: string } }) =>
    createElement('article', { 'data-testid': `listing-${listing.id}` }, listing.title),
}));

vi.mock('@/components/marketplace/UrgencyStrip', () => ({
  UrgencyStrip: ({
    closingSoonCount,
  }: { closingSoonCount: number }) =>
    createElement('div', { 'data-testid': 'urgency-strip' }, `closing:${String(closingSoonCount)}`),
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

// useListings returns the seeded initialData by default (success path). Tests
// that need the loading/error branches override listingsState before rendering.
vi.mock('@/hooks/useListings', () => ({
  useListings: (
    _params: unknown,
    options?: { initialData?: ListingsResponse },
  ) => ({
    ...listingsState,
    // Mirror TanStack: while loading or errored there is no resolved data; on
    // the success path the seeded initialData is what first paint renders.
    data:
      listingsState.isLoading || listingsState.isError
        ? undefined
        : (listingsState.data ?? options?.initialData),
  }),
  useListingsAutocomplete: () => ({ data: { suggestions: [] }, isLoading: false }),
  useSimilarListings: () => ({ data: { listings: [] }, isLoading: false, isError: false }),
  useTrendingListings: () => ({ data: { listings: [] }, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({ items: [], add: vi.fn(), remove: vi.fn(), clear: vi.fn() }),
  useRecordRecentView: () => undefined,
  useRecentlyViewedListings: () => ({ listings: [], isLoading: false }),
}));

import { ListingBrowseClient } from '@/components/marketplace/ListingBrowseClient';

const EMPTY_SEED: ListingsResponse = {
  listings: [],
  pagination: { totalCount: 0, page: 1, pageSize: 60, totalPages: 0, hasNext: false },
};

function renderClient(seed: ListingsResponse = EMPTY_SEED) {
  return render(
    withQueryClient(createElement(ListingBrowseClient, { initialListings: seed })),
  );
}

beforeEach(() => {
  listingsState.data = undefined;
  listingsState.isLoading = false;
  listingsState.isError = false;
  listingsState.refetch = vi.fn();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ListingBrowseClient', () => {
  it('renders the page header', () => {
    renderClient();
    expect(screen.getByRole('heading', { name: /The .*Live.* Marketplace/i })).toBeDefined();
    expect(
      screen.getByText(/Auctions are watched, not posted/i),
    ).toBeDefined();
  });

  it('renders skeletons while loading', () => {
    listingsState.isLoading = true;
    const { container } = renderClient();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the error empty state on isError', () => {
    listingsState.isError = true;
    renderClient();
    expect(screen.getByText(/Failed to load auctions/i)).toBeDefined();
  });

  it('clicking Retry on error invokes refetch', () => {
    const refetch = vi.fn();
    listingsState.isError = true;
    listingsState.refetch = refetch;
    renderClient();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty state with no filters', () => {
    renderClient();
    expect(screen.getByText(/No live auctions right now/i)).toBeDefined();
  });

  it('renders listing cards on first paint from the seeded initialListings', () => {
    const seed: ListingsResponse = {
      listings: [
        // Far-future end times so they bucket into "Later Today".
        {
          id: 'a',
          title: 'Sofa',
          auction_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
          bid_count: 1,
        },
        {
          id: 'b',
          title: 'Bike',
          auction_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
          bid_count: 2,
        },
      ] as unknown as ListingsResponse['listings'],
      pagination: { totalCount: 2, page: 1, pageSize: 60, totalPages: 1, hasNext: false },
    };
    renderClient(seed);
    expect(screen.getByTestId('listing-a')).toBeDefined();
    expect(screen.getByTestId('listing-b')).toBeDefined();
  });

  it('renders the urgency strip with the closing-soon count', () => {
    const seed: ListingsResponse = {
      listings: [
        {
          id: 'a',
          title: 'A',
          auction_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
          bid_count: 0,
        },
      ] as unknown as ListingsResponse['listings'],
      pagination: { totalCount: 1, page: 1, pageSize: 60, totalPages: 1, hasNext: false },
    };
    renderClient(seed);
    expect(screen.getByTestId('urgency-strip')).toBeDefined();
  });

  it('toggles the mobile filters panel', () => {
    renderClient();
    const toggle = screen.getByRole('button', { name: /Filters/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders the filters panel mocked component', () => {
    renderClient();
    expect(screen.getByTestId('filters')).toBeDefined();
  });
});
