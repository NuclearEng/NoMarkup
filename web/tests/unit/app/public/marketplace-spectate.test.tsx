// Marketplace spectate (Bloomberg terminal) page.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../dashboard/_helpers';
import { LISTING_STATUS } from '@/types';
import type { ListingDetail } from '@/types';

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

const bidsState = { data: undefined };

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

vi.mock('@/components/jobs/AuctionTimer', () => ({
  AuctionTimer: () => createElement('div', { 'data-testid': 'timer' }),
}));

vi.mock('@/components/ui/sparkline', () => ({
  Sparkline: () => createElement('div', { 'data-testid': 'sparkline' }),
}));

vi.mock('@/hooks/useListings', () => ({
  useListing: () => listingState,
  useListingBids: () => bidsState,
}));

vi.mock('@/hooks/useMarketplaceSpectator', () => ({
  useMarketplaceSpectator: () => spectatorState,
}));

import SpectatePage from '@/app/(public)/marketplace/[id]/spectate/page';

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
};

beforeEach(() => {
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
    const { container } = render(withQueryClient(createElement(SpectatePage)));
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders Retry on error and invokes refetch', () => {
    listingState.isError = true;
    listingState.data = undefined;
    render(withQueryClient(createElement(SpectatePage)));
    expect(screen.getByText('Failed to load listing')).toBeDefined();
    screen.getByRole('button', { name: /Retry/i }).click();
    expect(listingState.refetch).toHaveBeenCalled();
  });

  it('renders the SPECTATE badge', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(SpectatePage)));
    expect(screen.getByText('SPECTATE')).toBeDefined();
  });

  it('does not claim LIVE when the spectator socket is disconnected', () => {
    listingState.data = detail;
    spectatorState.isConnected = false;
    render(withQueryClient(createElement(SpectatePage)));
    expect(screen.getByText('OFFLINE')).toBeDefined();
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('shows LIVE only when the spectator socket is connected', () => {
    listingState.data = detail;
    spectatorState.isConnected = true;
    spectatorState.connectionStatus = 'connected';
    render(withQueryClient(createElement(SpectatePage)));
    expect(screen.getByText('LIVE')).toBeDefined();
  });

  it('renders the current bid as the hero number', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(SpectatePage)));
    expect(screen.getByText('$85.00')).toBeDefined();
  });

  it('renders the bidder/bid count summary line', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(SpectatePage)));
    expect(screen.getByText(/4 bidders · 9 bids/)).toBeDefined();
  });

  it('renders the timer panel', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(SpectatePage)));
    expect(screen.getByTestId('timer')).toBeDefined();
  });
});
