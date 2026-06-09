// Listing detail — the page is now an async Server Component (server fetch +
// notFound) and all interactivity lives in ListingDetailClient. These tests
// render the client island directly with a seeded `initialListing`, mirroring
// what the server passes in. The seed means there is no first-paint loading
// state; the error path is exercised by forcing the query into an error state.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// useListing returns the seeded initialData by default (success path). Tests
// that need the loading/error branches override listingState before rendering.
vi.mock('@/hooks/useListings', () => ({
  useListing: (_id: string, options?: { initialData?: ListingDetail }) => ({
    ...listingState,
    // Mirror TanStack: while loading or errored there is no resolved data; on
    // the success path the seeded initialData is what first paint renders.
    data:
      listingState.isLoading || listingState.isError
        ? undefined
        : (listingState.data ?? options?.initialData),
  }),
  useListingBids: () => bidsState,
  usePlaceListingBid: () => placeBidState,
  useSimilarListings: () => ({ data: { listings: [] }, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: () => ({ timeLeft: '2d 4h', isExpired: false, totalSeconds: 100_000 }),
}));

// Mutable auth state so individual tests can pose as anon / buyer / seller.
const authState: { user: { id: string } | null; isAuthenticated: boolean } = {
  user: null,
  isAuthenticated: false,
};
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector(authState),
}));

// Offer child components are exercised in their own suites; here we stub
// them to assert the parent's gating/wiring (which surface renders when).
vi.mock('@/components/marketplace/OfferModal', () => ({
  OfferModal: ({ open }: { open: boolean }) =>
    open
      ? createElement('div', { 'data-testid': 'offer-modal' }, 'offer modal')
      : null,
}));
vi.mock('@/components/marketplace/BuyerOfferCard', () => ({
  BuyerOfferCard: () =>
    createElement('div', { 'data-testid': 'buyer-offer-card' }, 'buyer offer'),
}));
vi.mock('@/components/marketplace/CounterOfferBanner', () => ({
  CounterOfferBanner: () =>
    createElement('div', { 'data-testid': 'counter-offer-banner' }, 'seller offers'),
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

import { ListingDetailClient } from '@/components/marketplace/ListingDetailClient';

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

function renderClient(seed: ListingDetail = detail) {
  return render(
    withQueryClient(
      createElement(ListingDetailClient, { listingId: 'l-1', initialListing: seed }),
    ),
  );
}

beforeEach(() => {
  listingState.data = undefined;
  listingState.isLoading = false;
  listingState.isError = false;
  listingState.refetch = vi.fn();
  authState.user = null;
  authState.isAuthenticated = false;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ListingDetailClient', () => {
  it('renders the loading skeleton when the query reports loading', () => {
    listingState.isLoading = true;
    const { container } = renderClient();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the not-found empty state on error', () => {
    listingState.isError = true;
    renderClient();
    expect(screen.getByText(/Listing not found/i)).toBeDefined();
  });

  it('renders real content on first paint from the seeded initialListing', () => {
    renderClient();
    expect(screen.getAllByText('Test sofa').length).toBeGreaterThan(0);
    expect(screen.getByText('Test description')).toBeDefined();
    expect(screen.getByText('$75.00')).toBeDefined();
  });

  it('renders the seller card with display name and trust tier', () => {
    renderClient();
    expect(screen.getByText('Jane')).toBeDefined();
    expect(screen.getByText(/trusted seller/i)).toBeDefined();
  });

  it('renders the bid panel and timer', () => {
    renderClient();
    expect(screen.getByTestId('bid-panel')).toBeDefined();
    expect(screen.getAllByTestId('timer').length).toBeGreaterThan(0);
  });

  it('renders the snipe banner when extensions > 0', () => {
    renderClient({ ...detail, snipe_extension_count: 1 });
    expect(screen.getByTestId('snipe-banner')).toBeDefined();
  });

  it('hides the snipe banner when extensions = 0', () => {
    renderClient();
    expect(screen.queryByTestId('snipe-banner')).toBeNull();
  });

  it('renders the privacy notice when pickup_address is null', () => {
    renderClient();
    expect(
      screen.getByText(/Full pickup address is shared with the winning bidder/i),
    ).toBeDefined();
  });

  it('renders the spectate link', () => {
    renderClient();
    const link = screen.getByText(/Watch live/i).closest('a');
    expect(link?.getAttribute('href')).toBe('/marketplace/l-1/spectate');
  });
});

describe('ListingDetailClient — Best-Offer wiring', () => {
  it('shows a buyer the Make-an-offer button + own-offer card (not the seller banner)', () => {
    authState.user = { id: 'buyer-9' };
    authState.isAuthenticated = true;
    renderClient(); // seller is 's-1', viewer is buyer-9 → buyer surface
    expect(screen.getByRole('button', { name: /make an offer/i })).toBeDefined();
    expect(screen.getByTestId('buyer-offer-card')).toBeDefined();
    expect(screen.queryByTestId('counter-offer-banner')).toBeNull();
  });

  it('opens the OfferModal when the buyer clicks Make an offer', async () => {
    authState.user = { id: 'buyer-9' };
    authState.isAuthenticated = true;
    renderClient();
    expect(screen.queryByTestId('offer-modal')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /make an offer/i }));
    expect(screen.getByTestId('offer-modal')).toBeDefined();
  });

  it('shows the seller the CounterOfferBanner (not the buyer surface)', () => {
    authState.user = { id: 's-1' }; // matches detail.seller_id
    authState.isAuthenticated = true;
    renderClient();
    expect(screen.getByTestId('counter-offer-banner')).toBeDefined();
    expect(screen.queryByRole('button', { name: /make an offer/i })).toBeNull();
    expect(screen.queryByTestId('buyer-offer-card')).toBeNull();
  });

  it('hides all offer UI for an anonymous (unauthenticated) viewer', () => {
    renderClient();
    expect(screen.queryByRole('button', { name: /make an offer/i })).toBeNull();
    expect(screen.queryByTestId('buyer-offer-card')).toBeNull();
    expect(screen.queryByTestId('counter-offer-banner')).toBeNull();
  });

  it('hides all offer UI on a non-active (sold) listing even for a buyer', () => {
    authState.user = { id: 'buyer-9' };
    authState.isAuthenticated = true;
    renderClient({ ...detail, status: LISTING_STATUS.SOLD });
    expect(screen.queryByRole('button', { name: /make an offer/i })).toBeNull();
    expect(screen.queryByTestId('buyer-offer-card')).toBeNull();
    expect(screen.queryByTestId('counter-offer-banner')).toBeNull();
  });

  it('hides the seller banner on a non-active listing', () => {
    authState.user = { id: 's-1' };
    authState.isAuthenticated = true;
    renderClient({ ...detail, status: LISTING_STATUS.SOLD });
    expect(screen.queryByTestId('counter-offer-banner')).toBeNull();
  });
});
