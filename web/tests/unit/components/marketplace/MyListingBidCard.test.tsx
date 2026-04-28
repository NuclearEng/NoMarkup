import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

vi.mock('next/image', () => ({
  default: ({ alt, src, ...rest }: { alt: string; src: string }) =>
    createElement('img', { alt, src, ...rest }),
}));

import { MyListingBidCard } from '@/components/marketplace/MyListingBidCard';
import { LISTING_STATUS } from '@/types';
import type { Listing, MyListingBid } from '@/types';

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    seller_id: 'seller-1',
    category_id: 'cat-1',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Test listing',
    description: 'desc',
    status: LISTING_STATUS.ACTIVE,
    photos: [{ id: 'p', url: 'x', blur_hash: null, sort_order: 0 }],
    pickup_zip: '94110',
    pickup_city: null,
    pickup_state: null,
    pickup_address: null,
    pickup_lat: null,
    pickup_lng: null,
    starting_price_cents: 5000,
    current_bid_cents: 6000,
    min_increment_cents: 100,
    bidder_count: 2,
    bid_count: 4,
    auction_duration_hours: 48,
    auction_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    snipe_extension_count: 0,
    distance_km: null,
    is_user_winning: false,
    was_outbid: false,
    created_at: '2026-04-20T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z',
    ...overrides,
  };
}

function makeEntry(listingOverrides: Partial<Listing> = {}): MyListingBid {
  return {
    bid: {
      id: 'bid-1',
      listing_id: 'listing-1',
      bidder_id: 'me',
      bidder_display_name: 'Me',
      amount_cents: 5500,
      is_winning: false,
      created_at: new Date().toISOString(),
    },
    listing: makeListing(listingOverrides),
  };
}

describe('MyListingBidCard', () => {
  it('renders winning badge when user is winning', () => {
    render(<MyListingBidCard entry={makeEntry({ is_user_winning: true })} />);
    expect(screen.getByText('Winning')).toBeDefined();
  });

  it('renders outbid badge when user is not winning and listing is active', () => {
    render(<MyListingBidCard entry={makeEntry({ is_user_winning: false })} />);
    expect(screen.getByText('Outbid')).toBeDefined();
  });

  it('renders won badge when user wins a sold listing', () => {
    render(
      <MyListingBidCard
        entry={makeEntry({ is_user_winning: true, status: LISTING_STATUS.SOLD })}
      />,
    );
    expect(screen.getByText('Won')).toBeDefined();
  });

  it('renders lost badge when user did not win a sold listing', () => {
    render(
      <MyListingBidCard
        entry={makeEntry({ is_user_winning: false, status: LISTING_STATUS.SOLD })}
      />,
    );
    expect(screen.getByText('Lost')).toBeDefined();
  });

  it('shows the user\'s bid amount and current bid', () => {
    render(<MyListingBidCard entry={makeEntry()} />);
    // user bid: $55.00; current bid: $60.00
    expect(screen.getByText('$55.00')).toBeDefined();
    expect(screen.getByText('$60.00')).toBeDefined();
  });

  it('links to the listing detail page', () => {
    render(<MyListingBidCard entry={makeEntry()} />);
    const link = screen.getByText(/View listing/);
    expect(link.closest('a')?.getAttribute('href')).toBe('/marketplace/listing-1');
  });
});
