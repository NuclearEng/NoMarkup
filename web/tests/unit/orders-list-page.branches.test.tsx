// Branch coverage for the goods /orders list page: loading skeleton, the
// status → badge mapping, pickup location, photo fallback and the role label
// before the signed-in user has hydrated.
import { render, screen, within } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ListingOrder, ListingOrderStatus } from '@/types';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) =>
    createElement('img', {
      src: props.src as string,
      alt: props.alt as string,
      'data-testid': 'order-photo',
    }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));

interface MyOrdersResult {
  data: ListingOrder[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

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

function loaded(orders: ListingOrder[]): MyOrdersResult {
  return { data: orders, isLoading: false, isError: false, refetch: vi.fn() };
}

afterEach(() => {
  useMyOrders.mockReset();
  useMyOrders.mockImplementation(() => LOADED_EMPTY);
  useAuthStore.setState({ user: null, isAuthenticated: false, isHydrating: false });
});

describe('OrdersPage — states and badges', () => {
  it('shows three skeleton rows, and no empty state, while loading', () => {
    useMyOrders.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    render(<OrdersPage />);

    const list = screen.getByRole('list', { name: 'Loading orders' });
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText(/no orders yet/i)).toBeNull();
    expect(screen.queryByText(/couldn't load/i)).toBeNull();
  });

  it('treats a missing order list as empty', () => {
    useMyOrders.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<OrdersPage />);
    expect(screen.getByText(/no orders yet/i)).toBeInTheDocument();
  });

  it.each<[ListingOrderStatus, string, RegExp]>([
    ['pending', 'pending', /amber/],
    ['paid', 'paid', /emerald/],
    ['picked_up', 'picked up', /emerald/],
    ['completed', 'completed', /emerald/],
    ['disputed', 'disputed', /red/],
    ['cancelled', 'cancelled', /red/],
  ])('labels a %s order "%s" with the matching badge tone', (status, text, tone) => {
    useMyOrders.mockReturnValue(loaded([makeOrder({ status })]));
    render(<OrdersPage />);

    const badge = screen.getByText(text);
    expect(badge).toHaveTextContent(`Status: ${text}`);
    expect(badge.className).toMatch(tone);
  });

  it('falls back to a neutral badge for a status the client does not know', () => {
    const unknown = 'refund_pending' as ListingOrderStatus;
    useMyOrders.mockReturnValue(loaded([makeOrder({ status: unknown })]));
    render(<OrdersPage />);

    const badge = screen.getByText('refund pending');
    expect(badge.className).toMatch(/zinc/);
    expect(badge.className).not.toMatch(/emerald|red|amber/);
  });

  it('labels the order Buying, with the seller name, before the user has hydrated', () => {
    useMyOrders.mockReturnValue(loaded([makeOrder({ seller_id: 'user-buyer-1' })]));
    render(<OrdersPage />);

    expect(screen.getByText('Buying')).toBeInTheDocument();
    expect(screen.getByText('Seller: Mike Seller')).toBeInTheDocument();
    expect(screen.queryByText('Selling')).toBeNull();
  });

  it('shows the pickup city and state only when both are present', () => {
    useMyOrders.mockReturnValue(
      loaded([
        makeOrder({ id: 'with-location', listing_title: 'Has location' }),
        makeOrder({ id: 'no-state', listing_title: 'No state', pickup_state: '' }),
      ]),
    );
    render(<OrdersPage />);

    const withLocation = screen.getByRole('link', { name: /has location/i });
    expect(within(withLocation).getByText('Austin, TX')).toBeInTheDocument();
    const noState = screen.getByRole('link', { name: /no state/i });
    expect(within(noState).queryByText(/Austin/)).toBeNull();
  });

  it('renders the listing photo for a loadable URL and a placeholder otherwise', () => {
    useMyOrders.mockReturnValue(
      loaded([
        makeOrder({
          id: 'local-photo',
          listing_title: 'Local photo',
          listing_photo_url: '/uploads/ps5.jpg',
        }),
        makeOrder({
          id: 'foreign-photo',
          listing_title: 'Foreign photo',
          listing_photo_url: 'https://untrusted.invalid/ps5.jpg',
        }),
      ]),
    );
    render(<OrdersPage />);

    const local = screen.getByRole('link', { name: /local photo/i });
    expect(within(local).getByTestId('order-photo')).toHaveAttribute('src', '/uploads/ps5.jpg');
    const foreign = screen.getByRole('link', { name: /foreign photo/i });
    expect(within(foreign).queryByTestId('order-photo')).toBeNull();
  });
});
