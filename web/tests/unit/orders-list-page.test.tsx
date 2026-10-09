// Unit tests for the goods /orders LIST page (the buyer/seller "my orders"
// index). Covers:
//   - renders a card per order with title, status, amount, and a link to the
//     detail page (/orders/{id}),
//   - labels each card by the caller's role (Selling vs Buying) derived from
//     buyer_id/seller_id vs the current user,
//   - the empty state with a link to the marketplace,
//   - the error state with a Retry control.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ListingOrder, User } from '@/types';
import { USER_ROLE } from '@/types';

// next/image → a plain element so jsdom doesn't choke on the loader.
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) =>
    createElement('img', { src: props.src as string, alt: props.alt as string }),
}));

// next/link → a plain anchor so getByRole('link') + href assertions work.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));

// The shape the page consumes off useMyOrders (a slice of the real UseQueryResult).
interface MyOrdersResult {
  data: ListingOrder[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

// The page only reads useMyOrders; mock it so each case controls the state.
// Default to a benign empty-but-loaded result so any stray re-render (e.g. a
// store update during teardown) never destructures `undefined`.
const LOADED_EMPTY: MyOrdersResult = {
  data: [],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
const useMyOrders = vi.fn<() => MyOrdersResult>(() => LOADED_EMPTY);
vi.mock('@/hooks/useListings', () => ({
  useMyOrders: () => useMyOrders(),
}));

import { useAuthStore } from '@/stores/auth-store';

const { default: OrdersPage } = await import('@/app/(dashboard)/orders/page');

const CURRENT_USER: User = {
  id: 'user-buyer-1',
  email: 'buyer@example.com',
  displayName: 'Buyer One',
  avatarUrl: null,
  roles: [USER_ROLE.CUSTOMER, USER_ROLE.PROVIDER],
  status: 'active',
  emailVerified: true,
  phoneVerified: false,
  mfaEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
};

function makeOrder(over: Partial<ListingOrder>): ListingOrder {
  return {
    id: 'order-1',
    listing_id: 'listing-1',
    listing_title: 'PS5 Disc Edition',
    listing_photo_url: null,
    buyer_id: 'user-buyer-1',
    seller_id: 'user-seller-9',
    seller_display_name: 'Mike Seller',
    pickup_address: '123 Main St',
    pickup_zip: '78701',
    pickup_city: 'Austin',
    pickup_state: 'TX',
    amount_cents: 42000,
    platform_fee_cents: 0,
    status: 'completed',
    channel_id: null,
    paid_at: null,
    picked_up_at: null,
    seller_confirmed_at: null,
    completed_at: null,
    dispute_window_ends_at: null,
    created_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(QueryClientProvider, { client }, createElement(OrdersPage)),
  );
}

afterEach(() => {
  useMyOrders.mockReset();
  useMyOrders.mockImplementation(() => LOADED_EMPTY);
  useAuthStore.setState({ user: null, isAuthenticated: false, isHydrating: false });
});

describe('OrdersPage — goods /orders list', () => {
  it('renders a card per order linking to its detail page, with role + status', () => {
    useAuthStore.setState({ user: CURRENT_USER, isAuthenticated: true, isHydrating: false });
    useMyOrders.mockReturnValue({
      data: [
        makeOrder({
          id: 'order-buy',
          listing_title: 'Vintage vinyl collection',
          buyer_id: 'user-buyer-1',
          seller_id: 'user-seller-9',
          status: 'paid',
        }),
        makeOrder({
          id: 'order-sell',
          listing_title: 'Honda mower',
          buyer_id: 'user-someone-else',
          seller_id: 'user-buyer-1',
          status: 'completed',
        }),
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage();

    // Two order rows rendered as a semantic list.
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    // The buy order links to its detail route and is labeled "Buying".
    const buyLink = screen.getByRole('link', { name: /vintage vinyl collection/i });
    expect(buyLink).toHaveAttribute('href', '/orders/order-buy');
    expect(within(buyLink).getByText(/buying/i)).toBeInTheDocument();

    // The sell order links to its detail route and is labeled "Selling"
    // (current user is the seller_id on that order).
    const sellLink = screen.getByRole('link', { name: /honda mower/i });
    expect(sellLink).toHaveAttribute('href', '/orders/order-sell');
    expect(within(sellLink).getByText(/selling/i)).toBeInTheDocument();

    // Amount + status surface on the card.
    expect(within(buyLink).getByText(/\$420\.00/)).toBeInTheDocument();
    expect(within(buyLink).getByText(/paid/i)).toBeInTheDocument();
  });

  it('shows the empty state with a marketplace link when there are no orders', () => {
    useAuthStore.setState({ user: CURRENT_USER, isAuthenticated: true, isHydrating: false });
    useMyOrders.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/no orders yet/i)).toBeInTheDocument();
    const browseLink = screen.getByRole('link', { name: /browse the marketplace/i });
    expect(browseLink).toHaveAttribute('href', '/marketplace');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows an error state with a working Retry button', async () => {
    const refetch = vi.fn();
    useAuthStore.setState({ user: CURRENT_USER, isAuthenticated: true, isHydrating: false });
    useMyOrders.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    renderPage();

    expect(screen.getByText(/couldn't load your orders/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
