// Marketplace spectate (Bloomberg terminal) page.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../dashboard/_helpers';
import { LISTING_STATUS } from '@/types';
import type { ListingBidHistory, ListingDetail } from '@/types';

const listingState: {
  data: ListingDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
};

const bidsState: { data: ListingBidHistory | undefined } = { data: undefined };

const spectatorState: {
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  lastBid: null;
  watcherCount: number;
} = {
  isConnected: false,
  connectionStatus: 'disconnected',
  lastBid: null,
  watcherCount: 0,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/marketplace/l-1/spectate',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'l-1' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/landing/GradientMesh', () => ({
  GradientMesh: () => createElement('div', { 'data-testid': 'gradient-mesh' }),
}));

// Since afe7d21a the page is a thin shell around the shared TerminalGrid
// (hero price, bid count and timer are terminal widgets with their own tests,
// and need ResizeObserver/tooltip providers). Stub the grid like the jobs
// spectate test does and assert the data the page feeds it. The adapter hook
// useMarketplaceSpectatorTerminal is NOT mocked: it runs for real on top of
// the mocked listing/bids/spectator hooks below.
interface GridProps {
  sim: { currentLowest: number | undefined; bidCount: number; isRunning: boolean };
  auctionEndsAt: string;
  startingPriceCents: number;
  jobId: string;
  jobTitle: string;
}
const gridProps: { last: GridProps | undefined } = { last: undefined };

vi.mock('@/components/terminal/terminal-grid', () => ({
  TerminalGrid: (props: GridProps) => {
    gridProps.last = props;
    return createElement('div', { 'data-testid': 'terminal-grid' });
  },
}));

vi.mock('@/components/terminal/terminal-toolbar', () => ({
  TerminalToolbar: () => createElement('div', { 'data-testid': 'terminal-toolbar' }),
}));

vi.mock('@/hooks/useListings', () => ({
  useListing: () => listingState,
  useListingBids: () => bidsState,
}));

vi.mock('@/hooks/useMarketplaceSpectator', () => ({
  useMarketplaceSpectator: () => spectatorState,
}));

import SpectatePage from '@/app/(public)/marketplace/[id]/spectate/page';

function renderPage() {
  return render(withQueryClient(createElement(SpectatePage)));
}

const detail: ListingDetail = {
  id: 'l-1',
  seller_id: 's-1',
  category_id: 'cat',
  category_name: 'Furniture',
  category_slug: 'furniture',
  title: 'Spectator listing',
  description: 'desc',
  status: LISTING_STATUS.ACTIVE,
  photos: [],
  pickup_zip: '94110',
  pickup_city: 'San Francisco',
  pickup_state: 'CA',
  pickup_address: null,
  pickup_lat: null,
  pickup_lng: null,
  starting_price_cents: 5000,
  current_bid_cents: 8500,
  min_increment_cents: 100,
  bidder_count: 4,
  bid_count: 9,
  auction_duration_hours: 48,
  auction_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
  snipe_extension_count: 0,
  distance_km: null,
  is_user_winning: false,
  was_outbid: false,
  created_at: '2026-04-20T00:00:00Z',
  updated_at: '2026-04-20T00:00:00Z',
  seller_display_name: 'Jane',
  seller_member_since: '2024-01-01T00:00:00Z',
  seller_listings_count: 5,
  seller_trust_tier: 'trusted',
  seller_trust_score: 0.9,
  seller_average_rating: null,
  seller_review_count: 0,
};

beforeEach(() => {
  gridProps.last = undefined;
  bidsState.data = undefined;
  listingState.data = undefined;
  listingState.isLoading = false;
  listingState.isError = false;
  listingState.isFetching = false;
  listingState.refetch = vi.fn();
  spectatorState.isConnected = false;
  spectatorState.connectionStatus = 'disconnected';
  spectatorState.lastBid = null;
  spectatorState.watcherCount = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('SpectatePage', () => {
  it('renders the loading skeleton when loading', () => {
    listingState.isLoading = true;
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading auction' })).toBeDefined();
  });

  it('renders Retry on error and invokes refetch', () => {
    listingState.isError = true;
    listingState.data = undefined;
    renderPage();
    expect(screen.getByText('Failed to load listing')).toBeDefined();
    screen.getByRole('button', { name: /Retry/i }).click();
    expect(listingState.refetch).toHaveBeenCalled();
  });

  it('renders the SPECTATE badge', () => {
    listingState.data = detail;
    renderPage();
    expect(screen.getByText('SPECTATE')).toBeDefined();
  });

  it('does not claim LIVE when the spectator socket is disconnected', () => {
    listingState.data = detail;
    spectatorState.isConnected = false;
    renderPage();
    expect(screen.getByText('OFFLINE')).toBeDefined();
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('shows LIVE only when the spectator socket is connected', () => {
    listingState.data = detail;
    spectatorState.isConnected = true;
    spectatorState.connectionStatus = 'connected';
    renderPage();
    expect(screen.getByText('LIVE')).toBeDefined();
  });

  it('feeds the current high bid to the terminal as the hero price', () => {
    listingState.data = detail;
    renderPage();
    expect(screen.getByTestId('terminal-grid')).toBeDefined();
    // Goods are ascending auctions: the terminal's price slot carries the
    // leading (high) bid, here the listing's current bid of $85.00.
    expect(gridProps.last?.sim.currentLowest).toBe(8500);
    expect(gridProps.last?.startingPriceCents).toBe(5000);
    expect(gridProps.last?.jobId).toBe('l-1');
    expect(gridProps.last?.jobTitle).toBe('Spectator listing');
  });

  it('feeds the bid history count and leading bid to the terminal', () => {
    listingState.data = detail;
    const mkBid = (id: string, amount: number, at: string) => ({
      id,
      listing_id: 'l-1',
      bidder_id: `b-${id}`,
      bidder_display_name: '',
      amount_cents: amount,
      is_winning: false,
      created_at: at,
    });
    bidsState.data = {
      bids: [
        mkBid('1', 6000, '2026-04-20T01:00:00Z'),
        mkBid('2', 7000, '2026-04-20T02:00:00Z'),
        mkBid('3', 8500, '2026-04-20T03:00:00Z'),
      ],
      current_bid_cents: 8500,
      bidder_count: 3,
    };
    renderPage();
    expect(gridProps.last?.sim.bidCount).toBe(3);
    expect(gridProps.last?.sim.currentLowest).toBe(8500);
  });

  it('feeds the auction end time to the terminal timer', () => {
    listingState.data = detail;
    renderPage();
    expect(gridProps.last?.auctionEndsAt).toBe(detail.auction_ends_at);
  });
});
