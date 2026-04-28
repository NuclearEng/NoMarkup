// Listing detail page — covers loading, error, and key UI elements.
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
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

const bidsState = { data: undefined, isLoading: false };
const placeBidState = {
  mutate: vi.fn(),
  isPending: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/marketplace/l-1',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'l-1' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useListings', () => ({
  useListing: () => listingState,
  useListingBids: () => bidsState,
  usePlaceListingBid: () => placeBidState,
  useSimilarListings: () => ({ data: { listings: [] }, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: () => ({ timeLeft: '2d 4h', isExpired: false, totalSeconds: 100_000 }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    const state = { user: null, isAuthenticated: false };
    return selector(state);
  },
}));

vi.mock('@/components/marketplace/ListingPhotoCarousel', () => ({
  ListingPhotoCarousel: () =>
    createElement('div', { 'data-testid': 'photo-carousel' }, 'photos'),
}));

vi.mock('@/components/marketplace/ListingBidPanel', () => ({
  ListingBidPanel: () => createElement('div', { 'data-testid': 'bid-panel' }, 'bid panel'),
}));

vi.mock('@/components/marketplace/SnipeExtensionBanner', () => ({
  SnipeExtensionBanner: () => createElement('div', { 'data-testid': 'snipe-banner' }, 'snipe'),
}));

vi.mock('@/components/jobs/AuctionTimer', () => ({
  AuctionTimer: () => createElement('div', { 'data-testid': 'timer' }, 'timer'),
}));

vi.mock('@/components/ui/sparkline', () => ({
  Sparkline: () => createElement('div', { 'data-testid': 'sparkline' }),
}));

import ListingDetailPage from '@/app/(public)/marketplace/[id]/page';

const detail: ListingDetail = {
  id: 'l-1',
  seller_id: 's-1',
  category_id: 'cat',
  category_name: 'Furniture',
  category_slug: 'furniture',
  title: 'Test sofa',
  description: 'Test description',
  status: LISTING_STATUS.ACTIVE,
  photos: [],
  pickup_zip: '94110',
  pickup_city: 'San Francisco',
  pickup_state: 'CA',
  pickup_address: null,
  pickup_lat: null,
  pickup_lng: null,
  starting_price_cents: 5000,
  current_bid_cents: 7500,
  min_increment_cents: 100,
  bidder_count: 3,
  bid_count: 5,
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
  listingState.refetch = vi.fn();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ListingDetailPage', () => {
  it('renders the loading skeleton when loading', () => {
    listingState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ListingDetailPage)));
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the not-found empty state on error', () => {
    listingState.isError = true;
    render(withQueryClient(createElement(ListingDetailPage)));
    expect(screen.getByText(/Listing not found/i)).toBeDefined();
  });

  it('renders title, description, and current bid', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(ListingDetailPage)));
    expect(screen.getAllByText('Test sofa').length).toBeGreaterThan(0);
    expect(screen.getByText('Test description')).toBeDefined();
    expect(screen.getByText('$75.00')).toBeDefined();
  });

  it('renders the seller card with display name and trust tier', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(ListingDetailPage)));
    expect(screen.getByText('Jane')).toBeDefined();
    expect(screen.getByText(/trusted seller/i)).toBeDefined();
  });

  it('renders the bid panel and timer', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(ListingDetailPage)));
    expect(screen.getByTestId('bid-panel')).toBeDefined();
    expect(screen.getAllByTestId('timer').length).toBeGreaterThan(0);
  });

  it('renders the snipe banner when extensions > 0', () => {
    listingState.data = { ...detail, snipe_extension_count: 1 };
    render(withQueryClient(createElement(ListingDetailPage)));
    expect(screen.getByTestId('snipe-banner')).toBeDefined();
  });

  it('hides the snipe banner when extensions = 0', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(ListingDetailPage)));
    expect(screen.queryByTestId('snipe-banner')).toBeNull();
  });

  it('renders the privacy notice when pickup_address is null', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(ListingDetailPage)));
    expect(
      screen.getByText(/Full pickup address is shared with the winning bidder/i),
    ).toBeDefined();
  });

  it('renders the spectate link', () => {
    listingState.data = detail;
    render(withQueryClient(createElement(ListingDetailPage)));
    const link = screen.getByText(/Watch live/i).closest('a');
    expect(link?.getAttribute('href')).toBe('/marketplace/l-1/spectate');
  });
});
