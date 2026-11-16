// /me/positions — blotter of service bids (provider only), goods bids and
// watched auctions. Covers the role guard and loading / empty / populated
// states for each of the three sections, plus the 12-row cap.
import { render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

interface ServiceBid {
  id: string;
  job_id: string;
  status: string;
  amount_cents: number;
}

interface GoodsBidRow {
  bid: { id: string; amount_cents: number; is_winning: boolean };
  listing: { id: string; title: string; bid_count: number };
}

interface WatchedListing {
  id: string;
  title: string;
  status: string;
  bid_count: number;
  current_bid_cents: number | null;
}

interface AuthState {
  user: { roles: string[] } | null;
  isAuthenticated: boolean;
}

const authState: AuthState = { user: null, isAuthenticated: false };

const myBidsState: { data: { bids: ServiceBid[] } | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const goodsBidsState: { data: { bids: GoodsBidRow[] } | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const watchlistState: { data: { listings: WatchedListing[] } | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

const useMyBidsMock = vi.fn<(status: string | undefined, page: number) => typeof myBidsState>();
const useMyListingBidsMock = vi.fn<(page: number) => typeof goodsBidsState>();
const useWatchlistMock =
  vi.fn<(page: number, options: { enabled: boolean }) => typeof watchlistState>();

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: <T,>(selector: (state: AuthState) => T): T => selector(authState),
}));

vi.mock('@/hooks/useBids', () => ({
  useMyBids: (status: string | undefined, page: number) => useMyBidsMock(status, page),
}));

vi.mock('@/hooks/useListings', () => ({
  useMyListingBids: (page: number) => useMyListingBidsMock(page),
}));

vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: (page: number, options: { enabled: boolean }) => useWatchlistMock(page, options),
}));

import PositionsPage from '@/app/(dashboard)/me/positions/page';

function renderPage() {
  return render(withQueryClient(createElement(PositionsPage)));
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

function serviceBid(n: number, overrides: Partial<ServiceBid> = {}): ServiceBid {
  return {
    id: `bid-${String(n)}`,
    job_id: `job${String(n).padStart(5, '0')}-rest-of-uuid`,
    status: 'active',
    amount_cents: 10000 + n,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = null;
  authState.isAuthenticated = false;
  myBidsState.data = undefined;
  myBidsState.isLoading = false;
  goodsBidsState.data = undefined;
  goodsBidsState.isLoading = false;
  watchlistState.data = undefined;
  watchlistState.isLoading = false;
  useMyBidsMock.mockImplementation(() => myBidsState);
  useMyListingBidsMock.mockImplementation(() => goodsBidsState);
  useWatchlistMock.mockImplementation(() => watchlistState);
});

describe('PositionsPage — data hooks', () => {
  it('requests page 1 of each feed and gates the watchlist on authentication', () => {
    renderPage();

    expect(useMyBidsMock).toHaveBeenCalledWith(undefined, 1);
    expect(useMyListingBidsMock).toHaveBeenCalledWith(1);
    expect(useWatchlistMock).toHaveBeenCalledWith(1, { enabled: false });
  });

  it('enables the watchlist query once the user is authenticated', () => {
    authState.isAuthenticated = true;
    authState.user = { roles: ['customer'] };
    renderPage();

    expect(useWatchlistMock).toHaveBeenCalledWith(1, { enabled: true });
  });
});

describe('PositionsPage — service bids (role guard)', () => {
  it('shows the provider-only prompt when signed out, even while bids are loading', () => {
    myBidsState.isLoading = true;
    myBidsState.data = { bids: [serviceBid(1)] };
    renderPage();

    const bids = within(section('My service bids'));
    expect(bids.getByText('Provider bids only')).toBeInTheDocument();
    expect(bids.getByRole('link', { name: 'Become a provider' })).toHaveAttribute(
      'href',
      '/provider/onboarding',
    );
    expect(bids.queryByText(/^Job /)).toBeNull();
  });

  it('shows the provider-only prompt for a customer-only account', () => {
    authState.user = { roles: ['customer'] };
    renderPage();

    expect(within(section('My service bids')).getByText('Provider bids only')).toBeInTheDocument();
  });

  it('hides the prompt and the empty state while a provider’s bids load', () => {
    authState.user = { roles: ['customer', 'provider'] };
    myBidsState.isLoading = true;
    renderPage();

    const bids = within(section('My service bids'));
    expect(bids.queryByText('Provider bids only')).toBeNull();
    expect(bids.queryByText('No active bids')).toBeNull();
    expect(bids.queryByRole('list')).toBeNull();
  });

  it('shows the empty state with a Browse jobs link for a provider with no bids', () => {
    authState.user = { roles: ['provider'] };
    renderPage();

    const bids = within(section('My service bids'));
    expect(bids.getByText('No active bids')).toBeInTheDocument();
    expect(bids.getByRole('link', { name: 'Browse jobs' })).toHaveAttribute('href', '/jobs');
  });

  it('renders a provider’s bids with a truncated job id, humanised status and price', () => {
    authState.user = { roles: ['provider'] };
    myBidsState.data = {
      bids: [serviceBid(1, { job_id: 'abcdef1234567890', status: 'pending_review', amount_cents: 25050 })],
    };
    renderPage();

    const bids = within(section('My service bids'));
    const link = bids.getByRole('link', { name: /Job abcdef12…/ });
    expect(link).toHaveAttribute('href', '/jobs/abcdef1234567890');
    expect(link).toHaveTextContent('pending review');
    expect(link).toHaveTextContent('$250.50');
  });

  it('caps the service bids list at 12 rows', () => {
    authState.user = { roles: ['provider'] };
    myBidsState.data = { bids: Array.from({ length: 14 }, (_, i) => serviceBid(i)) };
    renderPage();

    expect(within(section('My service bids')).getAllByRole('listitem')).toHaveLength(12);
  });
});

describe('PositionsPage — goods bids', () => {
  it('shows neither rows nor the empty state while loading', () => {
    goodsBidsState.isLoading = true;
    renderPage();

    const goods = within(section('My goods bids'));
    expect(goods.queryByText('No goods bids')).toBeNull();
    expect(goods.queryByRole('list')).toBeNull();
  });

  it('shows the empty state when there are no goods bids', () => {
    goodsBidsState.data = { bids: [] };
    renderPage();

    expect(within(section('My goods bids')).getByText('No goods bids')).toBeInTheDocument();
  });

  it('labels winning and outbid rows differently and links to the listing', () => {
    goodsBidsState.data = {
      bids: [
        {
          bid: { id: 'gb-1', amount_cents: 4200, is_winning: true },
          listing: { id: 'l-1', title: 'Vintage amp', bid_count: 7 },
        },
        {
          bid: { id: 'gb-2', amount_cents: 9900, is_winning: false },
          listing: { id: 'l-2', title: 'Road bike', bid_count: 3 },
        },
      ],
    };
    renderPage();

    const goods = within(section('My goods bids'));
    const winning = goods.getByRole('link', { name: /Vintage amp/ });
    expect(winning).toHaveAttribute('href', '/marketplace/l-1');
    expect(winning).toHaveTextContent('Winning · 7 bids');
    expect(within(winning).getByText('$42.00')).toHaveClass('text-bid-winning');

    const outbid = goods.getByRole('link', { name: /Road bike/ });
    expect(outbid).toHaveAttribute('href', '/marketplace/l-2');
    expect(outbid).toHaveTextContent('Outbid · 3 bids');
    const outbidPrice = within(outbid).getByText('$99.00');
    expect(outbidPrice).toHaveClass('text-zinc-300');
    expect(outbidPrice).not.toHaveClass('text-bid-winning');
  });

  it('caps the goods bids list at 12 rows', () => {
    goodsBidsState.data = {
      bids: Array.from({ length: 13 }, (_, i) => ({
        bid: { id: `gb-${String(i)}`, amount_cents: 100, is_winning: false },
        listing: { id: `l-${String(i)}`, title: `Item ${String(i)}`, bid_count: 1 },
      })),
    };
    renderPage();

    expect(within(section('My goods bids')).getAllByRole('listitem')).toHaveLength(12);
  });
});

describe('PositionsPage — watched goods', () => {
  it('shows neither rows nor the empty state while loading', () => {
    watchlistState.isLoading = true;
    renderPage();

    const watching = within(section('Watching (goods)'));
    expect(watching.queryByText('Nothing on watch')).toBeNull();
    expect(watching.queryByRole('list')).toBeNull();
  });

  it('shows the empty state when nothing is watched', () => {
    watchlistState.data = { listings: [] };
    renderPage();

    const watching = within(section('Watching (goods)'));
    expect(watching.getByText('Nothing on watch')).toBeInTheDocument();
    expect(watching.getByRole('link', { name: 'Watchlist' })).toHaveAttribute(
      'href',
      '/me/watchlist',
    );
  });

  it('renders watched listings with humanised status, bid count and current bid', () => {
    watchlistState.data = {
      listings: [
        { id: 'l-9', title: 'Kayak', status: 'ending_soon', bid_count: 5, current_bid_cents: 31000 },
        { id: 'l-10', title: 'Canoe', status: 'active', bid_count: 0, current_bid_cents: null },
      ],
    };
    renderPage();

    const watching = within(section('Watching (goods)'));
    const kayak = watching.getByRole('link', { name: /Kayak/ });
    expect(kayak).toHaveAttribute('href', '/marketplace/l-9');
    expect(kayak).toHaveTextContent('ending soon · 5 bids');
    expect(kayak).toHaveTextContent('$310.00');

    // No bids yet: the price falls back to an em dash rather than $0.00.
    const canoe = watching.getByRole('link', { name: /Canoe/ });
    expect(canoe).toHaveTextContent('active · 0 bids');
    expect(canoe).toHaveTextContent('—');
    expect(canoe).not.toHaveTextContent('$');
  });

  it('caps the watched list at 12 rows', () => {
    watchlistState.data = {
      listings: Array.from({ length: 15 }, (_, i) => ({
        id: `l-${String(i)}`,
        title: `Listing ${String(i)}`,
        status: 'active',
        bid_count: 0,
        current_bid_cents: 100,
      })),
    };
    renderPage();

    expect(within(section('Watching (goods)')).getAllByRole('listitem')).toHaveLength(12);
  });
});
