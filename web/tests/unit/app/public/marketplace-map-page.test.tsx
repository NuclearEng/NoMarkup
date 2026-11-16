// /marketplace/map — map + "listings in view" panel. MOCKED: useListings,
// MarketplaceMap (a stub exposing the listings it got and a way to report a
// viewport), CountdownClock, next/link. PROVEN: the query it asks for, the
// loading / error / empty states, viewport filtering, row content and money
// formatting, and the mobile sheet toggle.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Listing, ListingsResponse, SearchListingsParams } from '@/types';

interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

const refetch = vi.fn();
const listingsState: {
  data: ListingsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };
const requestedParams: SearchListingsParams[] = [];

vi.mock('@/hooks/useListings', () => ({
  useListings: (params: SearchListingsParams) => {
    requestedParams.push(params);
    return { ...listingsState, refetch };
  },
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

// The Mission District viewport: only listings inside it stay in the panel.
const MISSION: Bounds = { north: 37.77, south: 37.74, east: -122.4, west: -122.43 };

vi.mock('@/components/marketplace/MarketplaceMap', () => ({
  MarketplaceMap: ({
    listings,
    onViewportChange,
  }: {
    listings: Listing[];
    onViewportChange: (b: Bounds) => void;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'map', 'data-ids': listings.map((l) => l.id).join(',') },
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onViewportChange(MISSION);
          },
        },
        'pan to mission',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onViewportChange({ north: 1, south: 0, east: 1, west: 0 });
          },
        },
        'pan to ocean',
      ),
    ),
}));

vi.mock('@/components/marketplace/CountdownClock', () => ({
  CountdownClock: ({ endsAt }: { endsAt: string }) =>
    createElement('span', { 'data-testid': 'countdown' }, `ends ${endsAt}`),
}));

import MarketplaceMapPage from '@/app/(public)/marketplace/map/page';

function listing(overrides: Partial<Listing>): Listing {
  return {
    id: 'l-1',
    seller_id: 's-1',
    category_id: 'c-1',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Oak table',
    description: 'Solid oak dining table.',
    status: 'active',
    photos: [],
    pickup_zip: '94110',
    pickup_city: 'San Francisco',
    pickup_state: 'CA',
    pickup_address: null,
    pickup_lat: 37.75,
    pickup_lng: -122.41,
    starting_price_cents: 5000,
    current_bid_cents: 7550,
    min_increment_cents: 100,
    bidder_count: 2,
    bid_count: 3,
    auction_duration_hours: 48,
    auction_ends_at: '2026-03-03T12:00:00.000Z',
    snipe_extension_count: 0,
    distance_km: null,
    is_user_winning: false,
    was_outbid: false,
    created_at: '2026-03-01T12:00:00.000Z',
    updated_at: '2026-03-01T12:00:00.000Z',
    ...overrides,
  };
}

const IN_MISSION = listing({ id: 'in-mission', title: 'Oak table' });
const IN_OAKLAND = listing({
  id: 'in-oakland',
  title: 'Road bike',
  pickup_city: null,
  pickup_zip: '94607',
  pickup_lat: 37.8,
  pickup_lng: -122.27,
  current_bid_cents: 123456,
  auction_ends_at: null,
});
const NO_COORDS = listing({
  id: 'no-coords',
  title: 'Mystery box',
  pickup_lat: null,
  pickup_lng: null,
});

function setListings(listings: Listing[]) {
  listingsState.data = {
    listings,
    pagination: { totalCount: listings.length, page: 1, pageSize: 200, totalPages: 1, hasNext: false },
  };
  listingsState.isLoading = false;
  listingsState.isError = false;
}

function panel() {
  return screen.getByRole('complementary', { name: 'Listings in current map view' });
}

function panelTitles(): string[] {
  return within(panel())
    .queryAllByRole('link')
    .map((a) => a.querySelector('p')?.textContent ?? '');
}

function sheetToggle() {
  return screen.getByRole('button', { name: /in view/ });
}

beforeEach(() => {
  refetch.mockReset();
  requestedParams.length = 0;
  setListings([IN_MISSION, IN_OAKLAND, NO_COORDS]);
});

describe('MarketplaceMapPage', () => {
  it('asks for a city-wide set: 200 listings, ending soonest, no geo filter', () => {
    render(<MarketplaceMapPage />);
    expect(requestedParams[0]).toEqual({ page: 1, page_size: 200, sort_by: 'ending_soon' });
  });

  it('links back to the marketplace scoreboard', () => {
    render(<MarketplaceMapPage />);
    expect(screen.getByRole('link', { name: 'Back to scoreboard' })).toHaveAttribute(
      'href',
      '/marketplace',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Map view' })).toBeInTheDocument();
  });

  it('gives the map every listing, including ones without coordinates', () => {
    render(<MarketplaceMapPage />);
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-ids',
      'in-mission,in-oakland,no-coords',
    );
  });

  it('before any viewport is reported, lists every listing that has coordinates', () => {
    render(<MarketplaceMapPage />);
    expect(panelTitles()).toEqual(['Oak table', 'Road bike']);
    expect(screen.getByText('2 in view')).toBeInTheDocument();
    expect(sheetToggle()).toHaveTextContent('2 in view (tap to expand)');
  });

  it('narrows the panel to listings inside the reported viewport', () => {
    render(<MarketplaceMapPage />);
    fireEvent.click(screen.getByRole('button', { name: 'pan to mission' }));
    expect(panelTitles()).toEqual(['Oak table']);
    expect(screen.getByText('1 in view')).toBeInTheDocument();
    // The map itself keeps the full set — only the panel is filtered.
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-ids',
      'in-mission,in-oakland,no-coords',
    );
  });

  it('tells the user to pan or zoom out when nothing is in the viewport', () => {
    render(<MarketplaceMapPage />);
    fireEvent.click(screen.getByRole('button', { name: 'pan to ocean' }));
    expect(panelTitles()).toEqual([]);
    expect(
      within(panel()).getByText(
        'No listings inside the current map view. Pan or zoom out to see more.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('0 in view')).toBeInTheDocument();
  });

  it('shows each row with a detail link, location, current bid and countdown', () => {
    render(<MarketplaceMapPage />);
    const rows = within(panel()).getAllByRole('link');
    const [mission, oakland] = rows;
    if (!mission || !oakland) throw new Error('expected two rows');

    expect(mission).toHaveAttribute('href', '/marketplace/in-mission');
    expect(within(mission).getByText('San Francisco')).toBeInTheDocument();
    expect(within(mission).getByText('$75.50')).toBeInTheDocument();
    expect(within(mission).getByTestId('countdown')).toHaveTextContent(
      'ends 2026-03-03T12:00:00.000Z',
    );

    // No city → falls back to the zip; no end time → no countdown.
    expect(oakland).toHaveAttribute('href', '/marketplace/in-oakland');
    expect(within(oakland).getByText('94607')).toBeInTheDocument();
    expect(within(oakland).getByText('$1,234.56')).toBeInTheDocument();
    expect(within(oakland).queryByTestId('countdown')).toBeNull();
  });

  it('shows loading placeholders instead of rows or the empty message while fetching', () => {
    listingsState.data = undefined;
    listingsState.isLoading = true;
    render(<MarketplaceMapPage />);
    const loading = within(panel()).getByRole('list', { name: 'Loading listings' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(within(loading).getAllByRole('listitem')).toHaveLength(6);
    expect(within(panel()).queryByText(/No listings inside/)).toBeNull();
    expect(screen.getByTestId('map')).toHaveAttribute('data-ids', '');
  });

  it('replaces the map with a retryable error when the fetch fails', () => {
    listingsState.data = undefined;
    listingsState.isError = true;
    render(<MarketplaceMapPage />);
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getByText('Failed to load map')).toBeInTheDocument();
    expect(screen.getByText(/Check your connection and try again/)).toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('expands and collapses the mobile sheet', () => {
    render(<MarketplaceMapPage />);
    const toggle = sheetToggle();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'map-sheet-list');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).not.toHaveTextContent('(tap to expand)');
    expect(toggle).toHaveTextContent('2 in view');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('(tap to expand)');
  });

  it('mirrors the same rows in the mobile sheet', () => {
    render(<MarketplaceMapPage />);
    const sheet = document.getElementById('map-sheet-list');
    if (!sheet) throw new Error('sheet list missing');
    expect(
      within(sheet)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['/marketplace/in-mission', '/marketplace/in-oakland']);
  });
});
