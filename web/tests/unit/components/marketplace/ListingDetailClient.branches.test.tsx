// ListingDetailClient — wiring and conditional rendering the page-level suite
// (tests/unit/app/public/marketplace-id.test.tsx) leaves open: the watch
// heart, bid history, reserve badge, counts and pluralisation, live-bid cache
// invalidation, the outbid toast, and everything the island passes to (and
// receives back from) the bid panel — place bid, bid-bond replay, retract.
//
// MOCKED: every data hook and every child component. The bid panel stub
// records the props it was given per variant so the tests can call the
// island's handlers exactly as the real panel would.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../../app/dashboard/_helpers';
import type { ListingBidPanel } from '@/components/marketplace/ListingBidPanel';
import { ApiError } from '@/lib/api';
import type { MarketplaceBidEventData } from '@/lib/marketplace-spectator-websocket';
import { formatCents } from '@/lib/utils';
import { LISTING_STATUS } from '@/types';
import type { ListingBid, ListingBidHistory, ListingDetail } from '@/types';

type PanelProps = ComponentProps<typeof ListingBidPanel>;
type PanelVariant = 'default' | 'dock';

interface PlaceBidVars {
  listingId: string;
  input: { amount_cents: number; max_bid_cents?: number };
}
interface PlaceBidOptions {
  onSuccess: () => void;
  onError: (err: unknown) => void;
}

const h = vi.hoisted(() => ({
  listing: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn<() => Promise<void>>(),
  },
  bids: { data: undefined as unknown },
  placeBid: { mutate: vi.fn(), isPending: false },
  retractBid: { mutate: vi.fn(), isPending: false },
  countdown: { isExpired: false },
  auth: { user: null as { id: string } | null, isAuthenticated: false },
  spectator: { isConnected: false, watcherCount: 0, lastBid: null as unknown },
  watchlist: { ids: [] as string[], enabledArgs: [] as (boolean | undefined)[] },
  watch: { mutate: vi.fn(), isPending: false },
  recordRecentView: vi.fn(),
  toastError: vi.fn(),
  panels: {} as Record<string, unknown>,
  offerModal: { currentPriceCents: -1 },
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('sonner', () => ({
  toast: { error: h.toastError, success: vi.fn() },
}));

vi.mock('@/hooks/useListings', () => ({
  useListing: (_id: string, options?: { initialData?: ListingDetail }) => ({
    isLoading: h.listing.isLoading,
    isError: h.listing.isError,
    refetch: h.listing.refetch,
    data:
      h.listing.isLoading || h.listing.isError
        ? undefined
        : (h.listing.data ?? options?.initialData),
  }),
  useListingBids: () => ({ data: h.bids.data }),
  usePlaceListingBid: () => h.placeBid,
  useRetractListingBid: () => h.retractBid,
}));

vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: () => ({ timeLeft: '1d', isExpired: h.countdown.isExpired, totalSeconds: 1 }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof h.auth) => unknown) => selector(h.auth),
}));

vi.mock('@/hooks/useMarketplaceSpectator', () => ({
  useMarketplaceSpectator: () => h.spectator,
}));

vi.mock('@/hooks/useRecentlyViewed', () => ({
  useRecordRecentView: h.recordRecentView,
}));

vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: (_page?: number, options?: { enabled?: boolean }) => {
    h.watchlist.enabledArgs.push(options?.enabled);
    return {
      data: options?.enabled
        ? { listings: h.watchlist.ids.map((id) => ({ id })), pagination: {} }
        : undefined,
    };
  },
  useWatchListing: () => h.watch,
}));

vi.mock('@/components/marketplace/ListingBidPanel', () => ({
  ListingBidPanel: (props: { variant?: string }) => {
    const variant = props.variant ?? 'default';
    h.panels[variant] = props;
    return createElement('div', { 'data-testid': `bid-panel-${variant}` });
  },
}));

vi.mock('@/components/bids/AnimatedPrice', () => ({
  AnimatedPrice: ({ cents }: { cents: number }) =>
    createElement('span', { 'data-testid': 'animated-price', 'data-cents': String(cents) }),
}));
vi.mock('@/components/chat/BlockButton', () => ({
  BlockButton: ({ userId, displayName }: { userId: string; displayName: string }) =>
    createElement('div', {
      'data-testid': 'block-button',
      'data-user-id': userId,
      'data-display-name': displayName,
    }),
}));
vi.mock('@/components/chat/ChatRelayAlias', () => ({
  ChatRelayAlias: ({ contextType, contextId }: { contextType: string; contextId: string }) =>
    createElement('div', { 'data-testid': 'chat-relay', 'data-context': `${contextType}:${contextId}` }),
}));
vi.mock('@/components/marketplace/BuyItNowButton', () => ({
  BuyItNowButton: ({ listing }: { listing: { id: string } }) =>
    createElement('div', { 'data-testid': 'buy-it-now', 'data-listing-id': listing.id }),
}));
vi.mock('@/components/marketplace/BuyerOfferCard', () => ({
  BuyerOfferCard: () => createElement('div', { 'data-testid': 'buyer-offer-card' }),
}));
vi.mock('@/components/marketplace/CounterOfferBanner', () => ({
  CounterOfferBanner: () => createElement('div', { 'data-testid': 'counter-offer-banner' }),
}));
vi.mock('@/components/marketplace/OfferModal', () => ({
  OfferModal: ({
    currentPriceCents,
    open,
    onOpenChange,
  }: {
    currentPriceCents: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => {
    h.offerModal.currentPriceCents = currentPriceCents;
    return open
      ? createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'offer-modal',
            onClick: () => {
              onOpenChange(false);
            },
          },
          'Close offer',
        )
      : null;
  },
}));
vi.mock('@/components/marketplace/ListingPhotoCarousel', () => ({
  ListingPhotoCarousel: ({ photos, alt }: { photos: unknown[]; alt: string }) =>
    createElement('div', {
      'data-testid': 'photo-carousel',
      'data-count': String(photos.length),
      'data-alt': alt,
    }),
}));
vi.mock('@/components/marketplace/ReportListingButton', () => ({
  ReportListingButton: ({ listingId, listingTitle }: { listingId: string; listingTitle: string }) =>
    createElement('div', {
      'data-testid': 'report-button',
      'data-listing-id': listingId,
      'data-title': listingTitle,
    }),
}));
vi.mock('@/components/marketplace/SimilarListings', () => ({
  SimilarListings: ({ listingId }: { listingId: string }) =>
    createElement('div', { 'data-testid': 'similar', 'data-listing-id': listingId }),
}));
vi.mock('@/components/marketplace/SnipeExtensionBanner', () => ({
  SnipeExtensionBanner: ({
    extensionCount,
    newEndTime,
  }: {
    extensionCount: number;
    newEndTime: string;
  }) =>
    createElement('div', {
      'data-testid': 'snipe-banner',
      'data-count': String(extensionCount),
      'data-end': newEndTime,
    }),
}));
vi.mock('@/components/jobs/AuctionTimer', () => ({
  AuctionTimer: ({ auctionEndsAt, compact }: { auctionEndsAt: string; compact?: boolean }) =>
    createElement('div', {
      'data-testid': compact ? 'timer-compact' : 'timer',
      'data-ends': auctionEndsAt,
    }),
}));
vi.mock('@/components/ui/sparkline', () => ({
  Sparkline: ({ data }: { data: number[] }) =>
    createElement('div', { 'data-testid': 'sparkline', 'data-series': data.join(',') }),
}));

import { ListingDetailClient } from '@/components/marketplace/ListingDetailClient';

const ENDS_AT = '2099-01-01T00:00:00.000Z';

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
  min_increment_cents: 250,
  bidder_count: 3,
  bid_count: 5,
  auction_duration_hours: 48,
  auction_ends_at: ENDS_AT,
  snipe_extension_count: 0,
  distance_km: null,
  is_user_winning: false,
  was_outbid: false,
  created_at: '2026-04-20T00:00:00Z',
  updated_at: '2026-04-20T00:00:00Z',
  seller_display_name: 'Jane',
  seller_member_since: '2024-01-15T12:00:00Z',
  seller_listings_count: 5,
  seller_trust_tier: 'trusted',
  seller_trust_score: 0.9,
  seller_average_rating: null,
  seller_review_count: 0,
};

function bid(overrides: Partial<ListingBid> & { id: string }): ListingBid {
  return {
    listing_id: 'l-1',
    bidder_id: 'u-other',
    bidder_display_name: 'Bidder',
    amount_cents: 6000,
    is_winning: false,
    created_at: '2026-04-21T10:00:00Z',
    ...overrides,
  };
}

function history(bids: ListingBid[]): ListingBidHistory {
  return { bids, current_bid_cents: bids[0]?.amount_cents ?? 0, bidder_count: bids.length };
}

function setListing(overrides: Partial<ListingDetail> = {}) {
  h.listing.data = { ...detail, ...overrides };
}

function signInAs(id: string) {
  h.auth.user = { id };
  h.auth.isAuthenticated = true;
}

function client(listingId = 'l-1') {
  return createElement(ListingDetailClient, { listingId, initialListing: detail });
}

function renderClient(queryClient?: QueryClient) {
  return render(withQueryClient(client(), queryClient));
}

function panel(variant: PanelVariant = 'default'): PanelProps {
  const props = h.panels[variant];
  if (!props) throw new Error(`the ${variant} bid panel was not rendered`);
  return props as PanelProps;
}

function lastPlaceBidCall(): { vars: PlaceBidVars; options: PlaceBidOptions | undefined } {
  const call = h.placeBid.mutate.mock.calls.at(-1) as
    | [PlaceBidVars, PlaceBidOptions | undefined]
    | undefined;
  if (!call) throw new Error('placeBid.mutate was not called');
  return { vars: call[0], options: call[1] };
}

function bondRequired(cents: number): ApiError {
  return new ApiError(402, JSON.stringify({ requires_bid_bond: true, bond_amount_cents: cents }));
}

function liveBid(overrides: Partial<MarketplaceBidEventData> = {}): MarketplaceBidEventData {
  return {
    type: 'bid_placed' as MarketplaceBidEventData['type'],
    listing_id: 'l-1',
    amount_cents: 8000,
    snipe_extension: false,
    snipe_extension_count: 0,
    new_auction_ends_at: null,
    timestamp: '2026-05-01T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  h.listing.data = undefined;
  h.listing.isLoading = false;
  h.listing.isError = false;
  h.listing.refetch = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  h.bids.data = undefined;
  h.placeBid.mutate = vi.fn();
  h.placeBid.isPending = false;
  h.retractBid.mutate = vi.fn();
  h.retractBid.isPending = false;
  h.countdown.isExpired = false;
  h.auth.user = null;
  h.auth.isAuthenticated = false;
  h.spectator.isConnected = false;
  h.spectator.watcherCount = 0;
  h.spectator.lastBid = null;
  h.watchlist.ids = [];
  h.watchlist.enabledArgs = [];
  h.watch.mutate = vi.fn();
  h.watch.isPending = false;
  h.recordRecentView.mockReset();
  h.toastError.mockReset();
  for (const key of Object.keys(h.panels)) {
    h.panels[key] = undefined;
  }
  h.offerModal.currentPriceCents = -1;
});

describe('ListingDetailClient — load failures', () => {
  it('lets the visitor retry or go back to the marketplace when the listing fails to load', () => {
    h.listing.isError = true;
    renderClient();
    expect(screen.getByText('Listing not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.listing.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Back to Marketplace' })).toHaveAttribute(
      'href',
      '/marketplace',
    );
    expect(screen.queryByTestId('bid-panel-default')).toBeNull();
  });

  it('shows only the loading placeholder while the query is loading', () => {
    h.listing.isLoading = true;
    renderClient();
    expect(screen.getByRole('status', { name: 'Loading listing' })).toBeInTheDocument();
    expect(screen.queryByText('Listing not found')).toBeNull();
    expect(screen.queryByTestId('bid-panel-default')).toBeNull();
  });

  it('records the visit for the "Recently viewed" rail', () => {
    renderClient();
    expect(h.recordRecentView).toHaveBeenCalledWith('l-1');
  });
});

describe('ListingDetailClient — watch heart', () => {
  it('is hidden from signed-out visitors and does not load their watchlist', () => {
    renderClient();
    expect(screen.queryByRole('button', { name: /watchlist/ })).toBeNull();
    expect(h.watchlist.enabledArgs).toContain(false);
    expect(h.watchlist.enabledArgs).not.toContain(true);
  });

  it('adds an unwatched listing to the watchlist', () => {
    signInAs('u-1');
    h.watchlist.ids = ['other-listing'];
    renderClient();
    const heart = screen.getByRole('button', { name: 'Add to watchlist' });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(heart);
    expect(h.watch.mutate).toHaveBeenCalledWith({ watching: true });
  });

  it('removes a watched listing from the watchlist', () => {
    signInAs('u-1');
    h.watchlist.ids = ['other-listing', 'l-1'];
    renderClient();
    const heart = screen.getByRole('button', { name: 'Remove from watchlist' });
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(heart);
    expect(h.watch.mutate).toHaveBeenCalledWith({ watching: false });
  });

  it('is disabled while the watch request is in flight', () => {
    signInAs('u-1');
    h.watch.isPending = true;
    renderClient();
    expect(screen.getByRole('button', { name: 'Add to watchlist' })).toBeDisabled();
  });
});

describe('ListingDetailClient — header actions by viewer', () => {
  it('gives a signed-out visitor Report and Block for the seller, but no chat alias', () => {
    renderClient();
    const report = screen.getByTestId('report-button');
    expect(report).toHaveAttribute('data-listing-id', 'l-1');
    expect(report).toHaveAttribute('data-title', 'Test sofa');
    const block = screen.getByTestId('block-button');
    expect(block).toHaveAttribute('data-user-id', 's-1');
    expect(block).toHaveAttribute('data-display-name', 'Jane');
    expect(screen.queryByTestId('chat-relay')).toBeNull();
  });

  it('gives a signed-in buyer the chat alias for this listing', () => {
    signInAs('u-1');
    renderClient();
    expect(screen.getByTestId('chat-relay')).toHaveAttribute('data-context', 'listing:l-1');
  });

  it('hides Report and Block from the seller', () => {
    signInAs('s-1');
    renderClient();
    expect(screen.queryByTestId('report-button')).toBeNull();
    expect(screen.queryByTestId('block-button')).toBeNull();
  });

  it('trims the seller id passed to Block', () => {
    setListing({ seller_id: '  s-1  ' });
    renderClient();
    expect(screen.getByTestId('block-button')).toHaveAttribute('data-user-id', 's-1');
  });

  it('hides Block when the seller id only differs from the viewer by case', () => {
    signInAs('ABC-1');
    setListing({ seller_id: 'abc-1' });
    renderClient();
    expect(screen.queryByTestId('block-button')).toBeNull();
    // Not the same id string, so the viewer is still treated as a buyer.
    expect(screen.getByTestId('report-button')).toBeInTheDocument();
  });

  it('hides Block when the listing has a blank seller id', () => {
    setListing({ seller_id: '   ' });
    renderClient();
    expect(screen.queryByTestId('block-button')).toBeNull();
  });

  it.each([
    [LISTING_STATUS.ACTIVE, 'active'],
    [LISTING_STATUS.SOLD, 'sold'],
    [LISTING_STATUS.CANCELLED, 'cancelled'],
  ])('labels a %s listing with its status', (status, label) => {
    setListing({ status });
    renderClient();
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('ListingDetailClient — listing facts', () => {
  it('passes the photos and title to the carousel', () => {
    setListing({
      photos: [
        { id: 'p1', url: 'https://cdn.test/1.jpg' },
        { id: 'p2', url: 'https://cdn.test/2.jpg' },
      ] as ListingDetail['photos'],
    });
    renderClient();
    const carousel = screen.getByTestId('photo-carousel');
    expect(carousel).toHaveAttribute('data-count', '2');
    expect(carousel).toHaveAttribute('data-alt', 'Test sofa');
  });

  it('shows city, state and zip for pickup', () => {
    renderClient();
    expect(screen.getByText('San Francisco, CA 94110')).toBeInTheDocument();
  });

  it('shows just the zip when the city and state are unknown', () => {
    setListing({ pickup_city: null, pickup_state: null });
    renderClient();
    const zipLine = screen.getAllByText(/94110/)[0];
    expect(zipLine?.textContent.trim()).toBe('94110');
    expect(screen.queryByText(/San Francisco/)).toBeNull();
  });

  it('shows the full address once it is shared with the viewer', () => {
    setListing({ pickup_address: '123 Main St' });
    renderClient();
    expect(screen.getByText('Address:').parentElement).toHaveTextContent('Address: 123 Main St');
    expect(screen.queryByText(/shared with the winning bidder/)).toBeNull();
  });

  it('keeps the address private otherwise', () => {
    renderClient();
    expect(
      screen.getByText(
        'Full pickup address is shared with the winning bidder after the auction ends.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Address:')).toBeNull();
  });

  it('shows the current bid, the starting price and the similar-items rail', () => {
    renderClient();
    const prices = screen.getAllByTestId('animated-price');
    expect(prices.map((p) => p.getAttribute('data-cents'))).toEqual(['7500', '7500']);
    expect(screen.getByText('Started at').textContent).toBe(`Started at ${formatCents(5000)}`);
    expect(screen.getByTestId('similar')).toHaveAttribute('data-listing-id', 'l-1');
    expect(screen.getByTestId('buy-it-now')).toHaveAttribute('data-listing-id', 'l-1');
    expect(screen.getByRole('link', { name: /Watch live/ })).toHaveAttribute(
      'href',
      '/marketplace/l-1/spectate',
    );
  });

  it('shows the timer in the hero and the dock when the auction has an end time', () => {
    renderClient();
    expect(screen.getByTestId('timer')).toHaveAttribute('data-ends', ENDS_AT);
    expect(screen.getByTestId('timer-compact')).toHaveAttribute('data-ends', ENDS_AT);
    expect(screen.queryByText('Auction not started')).toBeNull();
  });

  it('says the auction has not started when there is no end time', () => {
    setListing({ auction_ends_at: null });
    renderClient();
    expect(screen.getByText('Auction not started')).toBeInTheDocument();
    expect(screen.queryByTestId('timer')).toBeNull();
    expect(screen.queryByTestId('timer-compact')).toBeNull();
  });

  it('passes the extension count and new end time to the snipe banner', () => {
    setListing({ snipe_extension_count: 2 });
    renderClient();
    const banner = screen.getByTestId('snipe-banner');
    expect(banner).toHaveAttribute('data-count', '2');
    expect(banner).toHaveAttribute('data-end', ENDS_AT);
  });

  it('shows no snipe banner for an extended listing that has no end time', () => {
    setListing({ snipe_extension_count: 2, auction_ends_at: null });
    renderClient();
    expect(screen.queryByTestId('snipe-banner')).toBeNull();
  });

  it.each([
    ['a reserve is set and not yet met', { reserve_price_cents: 9000, reserve_met: false }, true],
    ['the reserve has been met', { reserve_price_cents: 9000, reserve_met: true }, false],
    ['there is no reserve', { reserve_price_cents: null, reserve_met: false }, false],
    ['reserve state is unknown', { reserve_price_cents: 9000, reserve_met: null }, false],
    ['the fields are absent', {}, false],
  ] satisfies [string, Partial<ListingDetail>, boolean][])(
    'reserve badge when %s',
    (_label, overrides, shown) => {
      setListing(overrides);
      renderClient();
      expect(screen.queryByText('Reserve not met') !== null).toBe(shown);
      // The hidden reserve price itself is never rendered.
      expect(screen.queryByText(formatCents(9000))).toBeNull();
    },
  );

  it.each([
    [1, 1, '1 bidder', '1 bid'],
    [3, 5, '3 bidders', '5 bids'],
    [0, 0, '0 bidders', '0 bids'],
  ])('pluralises %i bidder(s) and %i bid(s)', (bidderCount, bidCount, bidders, bids) => {
    setListing({ bidder_count: bidderCount, bid_count: bidCount });
    renderClient();
    const words = (label: string) => label.split(' ');
    const [bidderN = '', bidderWord = ''] = words(bidders);
    const [bidN = '', bidWord = ''] = words(bids);
    const bidderLabel = screen.getByText(bidderWord, { selector: 'span' });
    expect(bidderLabel.previousElementSibling).toHaveTextContent(bidderN);
    const bidLabel = screen.getByText(bidWord, { selector: 'span' });
    expect(bidLabel.previousElementSibling).toHaveTextContent(bidN);
  });
});

describe('ListingDetailClient — watching-now count', () => {
  it('uses the listing seed when the live socket reports fewer', () => {
    setListing({ watcher_count: 12 });
    h.spectator.watcherCount = 4;
    renderClient();
    expect(screen.getByLabelText('12 watching now')).toHaveTextContent('12live');
  });

  it('uses the live socket count when it is higher', () => {
    setListing({ watcher_count: 2 });
    h.spectator.watcherCount = 9;
    h.spectator.isConnected = true;
    renderClient();
    const watching = screen.getByLabelText('9 watching now');
    expect(watching).toHaveTextContent('9live');
    expect(watching.querySelector('[aria-hidden="true"]')).toHaveClass('animate-pulse');
  });

  it('falls back to the live count, without the pulse, when offline and unseeded', () => {
    h.spectator.watcherCount = 0;
    renderClient();
    const watching = screen.getByLabelText('0 watching now');
    expect(watching.querySelector('[aria-hidden="true"]')).not.toHaveClass('animate-pulse');
  });
});

describe('ListingDetailClient — bid history', () => {
  it('is hidden when there are no bids', () => {
    h.bids.data = history([]);
    renderClient();
    expect(screen.queryByText('Bid history')).toBeNull();
    expect(screen.queryByTestId('sparkline')).toBeNull();
  });

  it('lists bidders newest first with amounts and tags the winning bid', () => {
    h.bids.data = history([
      bid({ id: 'b3', bidder_display_name: 'Casey', amount_cents: 7500, is_winning: true }),
      bid({ id: 'b2', bidder_display_name: 'Blake', amount_cents: 6500 }),
      bid({ id: 'b1', bidder_display_name: 'Avery', amount_cents: 5500 }),
    ]);
    renderClient();
    const card = screen.getByText('Bid history').closest('[data-slot="card"]') ?? document.body;
    const rows = within(card as HTMLElement).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('span')?.textContent.trim())).toEqual([
      'Casey Winning',
      'Blake',
      'Avery',
    ]);
    expect(rows[0]).toHaveTextContent('$75.00');
    expect(rows[1]).toHaveTextContent('$65.00');
    expect(rows[2]).toHaveTextContent('$55.00');
    expect(screen.getAllByText('Winning')).toHaveLength(1);
  });

  it('charts the starting price followed by the bids oldest to newest', () => {
    h.bids.data = history([
      bid({ id: 'b3', amount_cents: 7500 }),
      bid({ id: 'b2', amount_cents: 6500 }),
      bid({ id: 'b1', amount_cents: 5500 }),
    ]);
    renderClient();
    expect(screen.getByTestId('sparkline')).toHaveAttribute('data-series', '5000,5500,6500,7500');
  });

  it('shows only the 8 most recent bids', () => {
    h.bids.data = history(
      Array.from({ length: 11 }, (_, i) =>
        bid({ id: `b${String(i)}`, bidder_display_name: `Bidder ${String(i)}` }),
      ),
    );
    renderClient();
    expect(screen.getAllByText(/^Bidder \d+/)).toHaveLength(8);
    expect(screen.getByText(/^Bidder 7/)).toBeInTheDocument();
    expect(screen.queryByText(/^Bidder 8/)).toBeNull();
  });
});

describe('ListingDetailClient — seller card', () => {
  function sellerCard() {
    return within(screen.getByTestId('seller-card'));
  }

  it('shows member-since month, listing count and trust tier', () => {
    setListing({ seller_trust_tier: 'top_rated' as ListingDetail['seller_trust_tier'] });
    renderClient();
    expect(sellerCard().getByText('Member since January 2024')).toBeInTheDocument();
    expect(sellerCard().getByText('5 listings')).toBeInTheDocument();
    expect(sellerCard().getByText('top rated seller')).toBeInTheDocument();
  });

  it('uses the singular for one listing and one review', () => {
    setListing({ seller_listings_count: 1, seller_review_count: 1, seller_average_rating: 4.5 });
    renderClient();
    expect(sellerCard().getByText('1 listing')).toBeInTheDocument();
    expect(sellerCard().getByTestId('seller-review-summary')).toHaveTextContent('(1 review)');
  });

  it('pluralises several reviews', () => {
    setListing({ seller_review_count: 12, seller_average_rating: 4.8 });
    renderClient();
    expect(sellerCard().getByTestId('seller-review-summary')).toHaveTextContent('(12 reviews)');
  });

  it('hides the review summary when a count arrives without an average', () => {
    setListing({ seller_review_count: 3, seller_average_rating: null });
    renderClient();
    expect(sellerCard().queryByTestId('seller-review-summary')).toBeNull();
  });

  it('shows no trust badge for a seller without a tier', () => {
    setListing({ seller_trust_tier: null });
    renderClient();
    expect(sellerCard().queryByText(/seller$/)).toBeNull();
  });
});

describe('ListingDetailClient — offers', () => {
  it('prices an offer against the current bid and closes the modal on request', () => {
    signInAs('u-1');
    renderClient();
    expect(h.offerModal.currentPriceCents).toBe(7500);
    fireEvent.click(screen.getByRole('button', { name: 'Make an offer' }));
    fireEvent.click(screen.getByTestId('offer-modal'));
    expect(screen.queryByTestId('offer-modal')).toBeNull();
  });

  it('prices an offer against the starting price when nobody has bid', () => {
    signInAs('u-1');
    setListing({ current_bid_cents: 0 });
    renderClient();
    expect(h.offerModal.currentPriceCents).toBe(5000);
  });
});

describe('ListingDetailClient — live updates', () => {
  it('refetches the listing and its bids when a live bid arrives', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const view = renderClient(queryClient);
    expect(invalidate).not.toHaveBeenCalled();

    h.spectator.lastBid = liveBid();
    view.rerender(withQueryClient(client(), queryClient));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['listings', 'l-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['listings', 'l-1', 'bids'] });
  });

  it('does not refetch when the island has no listing id', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    h.spectator.lastBid = liveBid();
    render(withQueryClient(client(''), queryClient));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('forwards the live bid timestamp and snipe flag to both bid panels', () => {
    h.spectator.lastBid = liveBid({ snipe_extension: true, timestamp: '2026-05-01T12:34:56Z' });
    renderClient();
    for (const variant of ['default', 'dock'] as const) {
      expect(panel(variant).lastLiveBidTimestamp).toBe('2026-05-01T12:34:56Z');
      expect(panel(variant).lastLiveBidExtended).toBe(true);
    }
  });

  it('passes no live bid to the panels before one arrives', () => {
    renderClient();
    expect(panel().lastLiveBidTimestamp).toBeNull();
    expect(panel().lastLiveBidExtended).toBe(false);
  });

  it('toasts when the viewer goes from winning to outbid', () => {
    signInAs('u-1');
    setListing({ is_user_winning: true });
    const queryClient = new QueryClient();
    const view = renderClient(queryClient);
    expect(h.toastError).not.toHaveBeenCalled();

    setListing({ is_user_winning: false, was_outbid: true });
    view.rerender(withQueryClient(client(), queryClient));
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError).toHaveBeenCalledWith(
      'You were outbid! Place another bid to take the lead.',
    );
  });

  it('does not toast when the lead is lost for another reason (e.g. a retract)', () => {
    signInAs('u-1');
    setListing({ is_user_winning: true });
    const queryClient = new QueryClient();
    const view = renderClient(queryClient);
    setListing({ is_user_winning: false, was_outbid: false });
    view.rerender(withQueryClient(client(), queryClient));
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('does not toast a visitor who arrives already outbid', () => {
    signInAs('u-1');
    setListing({ is_user_winning: false, was_outbid: true });
    renderClient();
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe('ListingDetailClient — bid panel state', () => {
  it('hands the panels the price, increment and viewer state', () => {
    signInAs('u-1');
    setListing({ is_user_winning: true });
    renderClient();
    for (const variant of ['default', 'dock'] as const) {
      const props = panel(variant);
      expect(props.currentBidCents).toBe(7500);
      expect(props.minIncrementCents).toBe(250);
      expect(props.isAuthenticated).toBe(true);
      expect(props.isOwnListing).toBe(false);
      expect(props.isUserWinning).toBe(true);
      expect(props.isAuctionExpired).toBe(false);
      expect(props.isSubmitting).toBe(false);
      expect(props.listingId).toBe('l-1');
      expect(props.bidBondRequirement).toBeNull();
    }
  });

  it('marks the panels as submitting while a bid is in flight', () => {
    h.placeBid.isPending = true;
    renderClient();
    expect(panel('default').isSubmitting).toBe(true);
    expect(panel('dock').isSubmitting).toBe(true);
  });

  it('closes bidding and removes the mobile dock once the countdown expires', () => {
    h.countdown.isExpired = true;
    renderClient();
    expect(panel('default').isAuctionExpired).toBe(true);
    expect(screen.queryByTestId('bid-panel-dock')).toBeNull();
  });

  it.each([LISTING_STATUS.SOLD, LISTING_STATUS.ENDED, LISTING_STATUS.CANCELLED])(
    'closes bidding and removes the dock on a %s listing even with time on the clock',
    (status) => {
      setListing({ status });
      renderClient();
      expect(panel('default').isAuctionExpired).toBe(true);
      expect(screen.queryByTestId('bid-panel-dock')).toBeNull();
    },
  );

  it('tells the panel the viewer is the seller and removes the dock', () => {
    signInAs('s-1');
    renderClient();
    expect(panel('default').isOwnListing).toBe(true);
    expect(screen.queryByTestId('bid-panel-dock')).toBeNull();
  });
});

describe('ListingDetailClient — retract', () => {
  const mine = bid({
    id: 'b-mine',
    bidder_id: 'u-1',
    is_winning: true,
    amount_cents: 7500,
    created_at: '2026-05-01T12:00:00Z',
  });

  it('offers the viewer their own winning bid for retraction', () => {
    signInAs('u-1');
    setListing({ is_user_winning: true });
    h.bids.data = history([mine, bid({ id: 'b-old' })]);
    renderClient();
    expect(panel().retractableBid).toEqual({ bidId: 'b-mine', createdAt: '2026-05-01T12:00:00Z' });
    expect(panel().isRetracting).toBe(false);
  });

  it('retracts that bid when the panel asks', () => {
    signInAs('u-1');
    setListing({ is_user_winning: true });
    h.bids.data = history([mine]);
    renderClient();
    act(() => {
      panel().onRetractBid?.();
    });
    expect(h.retractBid.mutate).toHaveBeenCalledWith({ listingId: 'l-1', bidId: 'b-mine' });
  });

  it('marks the panel as retracting while the request is in flight', () => {
    h.retractBid.isPending = true;
    renderClient();
    expect(panel().isRetracting).toBe(true);
  });

  it.each([
    ['the winning bid belongs to someone else', [bid({ id: 'b-x', is_winning: true })]],
    ['the viewer has only a losing bid', [bid({ id: 'b-y', bidder_id: 'u-1' })]],
    ['the bid history has not loaded', undefined],
  ])('offers nothing to retract when %s', (_label, bids) => {
    signInAs('u-1');
    setListing({ is_user_winning: true });
    h.bids.data = bids ? history(bids) : undefined;
    renderClient();
    expect(panel().retractableBid).toBeNull();
    act(() => {
      panel().onRetractBid?.();
    });
    expect(h.retractBid.mutate).not.toHaveBeenCalled();
  });

  it('offers nothing to retract when the viewer is not winning', () => {
    signInAs('u-1');
    h.bids.data = history([mine]);
    renderClient();
    expect(panel().retractableBid).toBeNull();
  });

  it('offers nothing to retract to a signed-out visitor', () => {
    setListing({ is_user_winning: true });
    h.bids.data = history([mine]);
    renderClient();
    expect(panel().retractableBid).toBeNull();
  });
});

describe.each(['default', 'dock'] as const)(
  'ListingDetailClient — placing a bid from the %s panel',
  (variant) => {
    it('sends the amount alone when no max bid is set', () => {
      signInAs('u-1');
      renderClient();
      act(() => {
        panel(variant).onPlaceBid(8000);
      });
      expect(h.placeBid.mutate).toHaveBeenCalledTimes(1);
      expect(lastPlaceBidCall().vars).toEqual({ listingId: 'l-1', input: { amount_cents: 8000 } });
    });

    it('includes the confidential max bid when one is set', () => {
      signInAs('u-1');
      renderClient();
      act(() => {
        panel(variant).onPlaceBid(8000, 15_000);
      });
      expect(lastPlaceBidCall().vars).toEqual({
        listingId: 'l-1',
        input: { amount_cents: 8000, max_bid_cents: 15_000 },
      });
    });

    it('shows the bond prompt on both panels when the gateway demands a bid bond', () => {
      signInAs('u-1');
      renderClient();
      act(() => {
        panel(variant).onPlaceBid(8000);
      });
      act(() => {
        lastPlaceBidCall().options?.onError(bondRequired(2500));
      });
      expect(panel('default').bidBondRequirement).toEqual({ bond_amount_cents: 2500 });
      expect(panel('dock').bidBondRequirement).toEqual({ bond_amount_cents: 2500 });
    });

    it('replays the same bid, max included, once the bond is authorized', () => {
      signInAs('u-1');
      renderClient();
      act(() => {
        panel(variant).onPlaceBid(8000, 15_000);
      });
      act(() => {
        lastPlaceBidCall().options?.onError(bondRequired(2500));
      });
      act(() => {
        panel(variant).onBidBondAuthorized?.();
      });
      expect(h.placeBid.mutate).toHaveBeenCalledTimes(2);
      expect(lastPlaceBidCall().vars).toEqual({
        listingId: 'l-1',
        input: { amount_cents: 8000, max_bid_cents: 15_000 },
      });
      expect(panel(variant).bidBondRequirement).toBeNull();
    });

    it('replays a bid without a max as amount only', () => {
      signInAs('u-1');
      renderClient();
      act(() => {
        panel(variant).onPlaceBid(8000);
      });
      act(() => {
        lastPlaceBidCall().options?.onError(bondRequired(2500));
      });
      act(() => {
        panel(variant).onBidBondAuthorized?.();
      });
      expect(lastPlaceBidCall().vars).toEqual({ listingId: 'l-1', input: { amount_cents: 8000 } });
    });

    it('does not replay the bid twice if authorization fires again', () => {
      signInAs('u-1');
      renderClient();
      act(() => {
        panel(variant).onPlaceBid(8000);
      });
      act(() => {
        lastPlaceBidCall().options?.onError(bondRequired(2500));
      });
      act(() => {
        panel(variant).onBidBondAuthorized?.();
      });
      act(() => {
        panel(variant).onBidBondAuthorized?.();
      });
      expect(h.placeBid.mutate).toHaveBeenCalledTimes(2);
    });

    it('places nothing when a bond is authorized with no bid pending', () => {
      signInAs('u-1');
      renderClient();
      act(() => {
        panel(variant).onBidBondAuthorized?.();
      });
      expect(h.placeBid.mutate).not.toHaveBeenCalled();
    });

    it.each([
      ['an ordinary rejection', new ApiError(409, JSON.stringify({ error: 'bid too low' }))],
      ['a 402 that is not a bond demand', new ApiError(402, JSON.stringify({ error: 'card' }))],
      ['a network failure', new TypeError('Failed to fetch')],
    ])('shows no bond prompt after %s', (_label, error) => {
      signInAs('u-1');
      renderClient();
      act(() => {
        panel(variant).onPlaceBid(8000);
      });
      act(() => {
        lastPlaceBidCall().options?.onError(error);
      });
      expect(panel(variant).bidBondRequirement).toBeNull();
    });

    it('clears the bond prompt and the pending bid when a later bid succeeds', () => {
      signInAs('u-1');
      renderClient();
      act(() => {
        panel(variant).onPlaceBid(8000);
      });
      act(() => {
        lastPlaceBidCall().options?.onError(bondRequired(2500));
      });
      act(() => {
        panel(variant).onPlaceBid(8500);
      });
      act(() => {
        lastPlaceBidCall().options?.onSuccess();
      });
      expect(panel(variant).bidBondRequirement).toBeNull();
      // Nothing is pending any more, so a stray authorization replays nothing.
      act(() => {
        panel(variant).onBidBondAuthorized?.();
      });
      expect(h.placeBid.mutate).toHaveBeenCalledTimes(2);
    });
  },
);
