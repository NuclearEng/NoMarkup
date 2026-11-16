// ListingBrowseClient — bucketing, scoreboard totals, search → filter wiring,
// and the seeded-vs-refetched query contract. Complements
// tests/unit/app/public/marketplace.test.tsx (header / loading / error / watch).
// MOCKED: every child island (cards, search bar, filters, strips) as thin
// stubs that expose the props they are given, plus useListings (records the
// params + options it is called with).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AutocompleteSuggestion,
  ListingsResponse,
  SearchListingsParams,
} from '@/types';

const NOW = new Date('2026-06-01T12:00:00.000Z').getTime();

const listingsState: {
  override: ListingsResponse | undefined;
  calls: { params: SearchListingsParams; seeded: boolean }[];
} = { override: undefined, calls: [] };

vi.mock('@/hooks/useListings', () => ({
  useListings: (params: SearchListingsParams, options?: { initialData?: ListingsResponse }) => {
    listingsState.calls.push({ params, seeded: options?.initialData !== undefined });
    return {
      data: listingsState.override ?? options?.initialData,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: () => ({ data: undefined }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: false }),
}));

vi.mock('@/components/marketplace/ScoreboardCard', () => ({
  ScoreboardCard: ({
    listing,
    urgency,
    imagePriority,
  }: {
    listing: { id: string; title: string };
    urgency?: string;
    imagePriority?: boolean;
  }) =>
    createElement(
      'article',
      {
        'data-testid': `card-${listing.id}`,
        'data-urgency': urgency ?? 'none',
        'data-priority': String(Boolean(imagePriority)),
      },
      listing.title,
    ),
}));

vi.mock('@/components/marketplace/UrgencyStrip', () => ({
  UrgencyStrip: ({
    closingSoonCount,
    totalWatchers,
    liveBidsCount,
  }: {
    closingSoonCount: number;
    totalWatchers: number;
    liveBidsCount: number;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'urgency-strip' },
      `closing:${String(closingSoonCount)} watchers:${String(totalWatchers)} bids:${String(liveBidsCount)}`,
    ),
}));

const searchBar: {
  defaultValue: string | undefined;
  submit: (q: string) => void;
  select: (s: AutocompleteSuggestion) => void;
} = { defaultValue: undefined, submit: () => undefined, select: () => undefined };

vi.mock('@/components/marketplace/SearchBar', () => ({
  SearchBar: ({
    defaultValue,
    onSubmitQuery,
    onSelectSuggestion,
  }: {
    defaultValue?: string;
    onSubmitQuery: (q: string) => void;
    onSelectSuggestion: (s: AutocompleteSuggestion) => void;
  }) => {
    searchBar.defaultValue = defaultValue;
    searchBar.submit = onSubmitQuery;
    searchBar.select = onSelectSuggestion;
    return createElement('div', { 'data-testid': 'search-bar' });
  },
}));

const filtersPanel: { filters: SearchListingsParams | undefined } = { filters: undefined };
vi.mock('@/components/marketplace/ListingFilters', () => ({
  ListingFilters: ({ filters }: { filters: SearchListingsParams }) => {
    filtersPanel.filters = filters;
    return createElement('div', { 'data-testid': 'filters' });
  },
}));

vi.mock('@/components/marketplace/TrendingRail', () => ({ TrendingRail: () => null }));
vi.mock('@/components/marketplace/RecentlyViewed', () => ({ RecentlyViewed: () => null }));
vi.mock('@/components/marketplace/SaveSearchButton', () => ({ SaveSearchButton: () => null }));

import { ListingBrowseClient } from '@/components/marketplace/ListingBrowseClient';

function listing(
  id: string,
  endsInMs: number | null,
  extra: { bid_count?: number; watcher_count?: number } = {},
) {
  return {
    id,
    title: `Item ${id}`,
    auction_ends_at: endsInMs === null ? null : new Date(NOW + endsInMs).toISOString(),
    bid_count: extra.bid_count ?? 0,
    ...(extra.watcher_count !== undefined ? { watcher_count: extra.watcher_count } : {}),
  };
}

function response(listings: ReturnType<typeof listing>[]): ListingsResponse {
  return {
    listings: listings as unknown as ListingsResponse['listings'],
    pagination: {
      totalCount: listings.length,
      page: 1,
      pageSize: 60,
      totalPages: 1,
      hasNext: false,
    },
  };
}

const EMPTY = response([]);

function sectionCards(name: string): string[] {
  const section = screen.getByRole('region', { name });
  return within(section)
    .getAllByRole('article')
    .map((card) => card.getAttribute('data-testid') ?? '');
}

function lastCall() {
  const call = listingsState.calls.at(-1);
  if (!call) throw new Error('useListings was not called');
  return call;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  listingsState.override = undefined;
  listingsState.calls = [];
  filtersPanel.filters = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ListingBrowseClient — urgency buckets', () => {
  const MIXED = response([
    listing('ten-min', 600_000),
    listing('ten-min-plus', 600_001),
    listing('one-hour', 3_600_000),
    listing('one-hour-plus', 3_600_001),
    listing('ended', -5_000),
    listing('no-end', null),
  ]);

  it('sorts auctions into Closing Now (≤10 min), Closing Soon (≤60 min) and Later Today', () => {
    render(<ListingBrowseClient initialListings={MIXED} />);
    expect(sectionCards('Closing Now')).toEqual(['card-ten-min', 'card-ended']);
    expect(sectionCards('Closing Soon')).toEqual(['card-ten-min-plus', 'card-one-hour']);
    // An auction with no end time is never "urgent".
    expect(sectionCards('Later Today')).toEqual(['card-one-hour-plus', 'card-no-end']);
  });

  it('passes each card the urgency of its section', () => {
    render(<ListingBrowseClient initialListings={MIXED} />);
    expect(screen.getByTestId('card-ten-min')).toHaveAttribute('data-urgency', 'critical');
    expect(screen.getByTestId('card-one-hour')).toHaveAttribute('data-urgency', 'urgent');
    expect(screen.getByTestId('card-no-end')).toHaveAttribute('data-urgency', 'none');
  });

  it('gives image priority to the first four cards on the page, counted across sections', () => {
    render(<ListingBrowseClient initialListings={MIXED} />);
    const priority = (id: string) => screen.getByTestId(`card-${id}`).getAttribute('data-priority');
    // Page order: ten-min, ended | ten-min-plus, one-hour | one-hour-plus, no-end
    expect(['ten-min', 'ended', 'ten-min-plus', 'one-hour'].map(priority)).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    expect(['one-hour-plus', 'no-end'].map(priority)).toEqual(['false', 'false']);
  });

  it('omits sections that have no auctions', () => {
    render(<ListingBrowseClient initialListings={response([listing('far', 86_400_000)])} />);
    expect(screen.queryByRole('region', { name: 'Closing Now' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Closing Soon' })).toBeNull();
    expect(sectionCards('Later Today')).toEqual(['card-far']);
  });

  it('shows only Closing Now when every auction is in its last minutes', () => {
    render(<ListingBrowseClient initialListings={response([listing('hot', 30_000)])} />);
    expect(sectionCards('Closing Now')).toEqual(['card-hot']);
    expect(screen.queryByRole('region', { name: 'Closing Soon' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Later Today' })).toBeNull();
    expect(screen.getByText('Last 10 minutes — bid before the gavel.')).toBeInTheDocument();
  });
});

describe('ListingBrowseClient — scoreboard totals', () => {
  it('reports closing-soon count, summed watchers and summed bids', () => {
    render(
      <ListingBrowseClient
        initialListings={response([
          listing('a', 60_000, { bid_count: 3, watcher_count: 7 }),
          listing('b', 1_800_000, { bid_count: 2 }),
          listing('c', 86_400_000, { bid_count: 10, watcher_count: 5 }),
        ])}
      />,
    );
    expect(screen.getByTestId('urgency-strip')).toHaveTextContent('closing:2 watchers:12 bids:15');
  });

  it('reports zeros for an empty marketplace', () => {
    render(<ListingBrowseClient initialListings={EMPTY} />);
    expect(screen.getByTestId('urgency-strip')).toHaveTextContent('closing:0 watchers:0 bids:0');
  });
});

describe('ListingBrowseClient — filters and search', () => {
  it('queries with the default browse filters and the server seed on first paint', () => {
    render(<ListingBrowseClient initialListings={EMPTY} />);
    expect(lastCall()).toEqual({
      params: { page: 1, page_size: 60, sort_by: 'ending_soon' },
      seeded: true,
    });
    expect(searchBar.defaultValue).toBe('');
  });

  it('starts from the URL-derived filters when the page passes them', () => {
    const initialFilters: SearchListingsParams = {
      page: 2,
      page_size: 60,
      sort_by: 'newest',
      query: 'sofa',
    };
    render(<ListingBrowseClient initialListings={EMPTY} initialFilters={initialFilters} />);
    expect(lastCall()).toEqual({ params: initialFilters, seeded: true });
    expect(searchBar.defaultValue).toBe('sofa');
    expect(filtersPanel.filters).toEqual(initialFilters);
  });

  it('a submitted search sets the query, resets to page 1 and drops the server seed', () => {
    render(
      <ListingBrowseClient
        initialListings={EMPTY}
        initialFilters={{ page: 3, page_size: 60, sort_by: 'newest' }}
      />,
    );
    act(() => {
      searchBar.submit('teak desk');
    });
    expect(lastCall()).toEqual({
      params: { page: 1, page_size: 60, sort_by: 'newest', query: 'teak desk' },
      seeded: false,
    });
  });

  it('an empty submitted search clears the query', () => {
    render(
      <ListingBrowseClient
        initialListings={EMPTY}
        initialFilters={{ page: 1, page_size: 60, query: 'sofa' }}
      />,
    );
    act(() => {
      searchBar.submit('');
    });
    expect(lastCall().params.query).toBeUndefined();
  });

  it('picking a category suggestion searches by its label', () => {
    render(<ListingBrowseClient initialListings={EMPTY} />);
    act(() => {
      searchBar.select({ type: 'category', category_slug: 'furniture', label: 'Furniture' });
    });
    expect(lastCall().params).toEqual({
      page: 1,
      page_size: 60,
      sort_by: 'ending_soon',
      query: 'Furniture',
    });
  });

  it('ignores a suggestion that has neither a listing id nor a category label', () => {
    render(<ListingBrowseClient initialListings={EMPTY} />);
    const callsBefore = listingsState.calls.length;
    act(() => {
      searchBar.select({ type: 'category', category_slug: 'furniture' });
      searchBar.select({ type: 'listing', title: 'No id' });
    });
    expect(listingsState.calls).toHaveLength(callsBefore);
  });
});

describe('ListingBrowseClient — empty state', () => {
  it('invites visitors back, with no Clear button, when no filters are active', () => {
    render(<ListingBrowseClient initialListings={EMPTY} />);
    expect(screen.getByText('No live auctions right now')).toBeInTheDocument();
    expect(screen.getByText(/The floor is quiet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it.each([
    ['a text query', { query: 'sofa' }],
    ['a category id', { category_id: 'c-1' }],
    ['a category slug', { category_slug: 'furniture' }],
    ['a pickup zip', { pickup_zip: '94110' }],
    ['a radius', { radius_km: 10 }],
    ['a minimum price', { min_price_cents: 0 }],
    ['a maximum price', { max_price_cents: 5000 }],
    ['ending soon', { ending_soon: true }],
  ] satisfies [string, Partial<SearchListingsParams>][])(
    'treats %s as an active filter',
    (_label, filter) => {
      render(
        <ListingBrowseClient
          initialListings={EMPTY}
          initialFilters={{ page: 1, page_size: 60, ...filter }}
        />,
      );
      expect(screen.getByText(/No auctions match your current filters/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
      // The mobile Filters toggle carries the "!" marker.
      expect(screen.getByRole('button', { name: /Filters/ })).toHaveTextContent('!');
    },
  );

  it('does not treat sort order or ending_soon=false as an active filter', () => {
    render(
      <ListingBrowseClient
        initialListings={EMPTY}
        initialFilters={{ page: 1, page_size: 60, sort_by: 'newest', ending_soon: false }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.getByRole('button', { name: /Filters/ })).not.toHaveTextContent('!');
  });

  it('Clear filters resets to page 1 of an unfiltered search', () => {
    render(
      <ListingBrowseClient
        initialListings={EMPTY}
        initialFilters={{ page: 4, page_size: 60, query: 'sofa', pickup_zip: '94110' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(lastCall()).toEqual({ params: { page: 1, page_size: 60 }, seeded: false });
    expect(screen.getByText(/The floor is quiet/)).toBeInTheDocument();
  });

  it('shows and hides the filters panel from the mobile toggle', () => {
    render(<ListingBrowseClient initialListings={EMPTY} />);
    const toggle = screen.getByRole('button', { name: /Filters/ });
    const panel = screen.getByRole('complementary');
    expect(toggle).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveClass('hidden');
    fireEvent.click(toggle);
    expect(panel).not.toHaveClass('hidden');
    fireEvent.click(toggle);
    expect(panel).toHaveClass('hidden');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('ListingBrowseClient — picking a listing suggestion', () => {
  it('navigates the browser to that listing', () => {
    const assign = vi.fn<(url: string) => void>();
    vi.stubGlobal('location', { assign });
    try {
      render(<ListingBrowseClient initialListings={EMPTY} />);
      const callsBefore = listingsState.calls.length;
      act(() => {
        searchBar.select({ type: 'listing', id: 'l-77', title: 'Lamp' });
      });
      expect(assign).toHaveBeenCalledWith('/marketplace/l-77');
      // Navigation, not a filter change.
      expect(listingsState.calls).toHaveLength(callsBefore);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
