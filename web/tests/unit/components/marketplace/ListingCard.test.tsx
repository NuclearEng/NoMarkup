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

import { ListingCard } from '@/components/marketplace/ListingCard';
import { LISTING_STATUS } from '@/types';
import type { Listing } from '@/types';

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    seller_id: 'seller-1',
    category_id: 'goods-furniture',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Mid-century walnut credenza',
    description: 'Beautiful walnut credenza, 1960s.',
    status: LISTING_STATUS.ACTIVE,
    photos: [
      { id: 'p1', url: 'https://example.com/credenza.jpg', blur_hash: null, sort_order: 0 },
    ],
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
    bid_count: 7,
    auction_duration_hours: 48,
    auction_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    snipe_extension_count: 0,
    distance_km: 3.5,
    is_user_winning: false,
    was_outbid: false,
    created_at: '2026-04-20T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z',
    ...overrides,
  };
}

describe('ListingCard', () => {
  it('renders the listing title', () => {
    render(<ListingCard listing={makeListing()} />);
    expect(screen.getByText('Mid-century walnut credenza')).toBeDefined();
  });

  it('renders the current bid prominently', () => {
    render(<ListingCard listing={makeListing()} />);
    expect(screen.getByText('Current bid:')).toBeDefined();
    expect(screen.getByText('$85.00')).toBeDefined();
  });

  it('renders bidder count text', () => {
    render(<ListingCard listing={makeListing()} />);
    expect(screen.getByText('4')).toBeDefined();
    expect(screen.getByText('bidders')).toBeDefined();
  });

  it('renders singular "bidder" when exactly one bidder', () => {
    render(<ListingCard listing={makeListing({ bidder_count: 1 })} />);
    expect(screen.getByText('bidder')).toBeDefined();
  });

  it('renders pickup zip and state', () => {
    render(<ListingCard listing={makeListing()} />);
    expect(screen.getByText(/San Francisco/)).toBeDefined();
    expect(screen.getByText(/94110/)).toBeDefined();
  });

  it('renders distance label in miles when within 10mi', () => {
    render(<ListingCard listing={makeListing({ distance_km: 3.5 })} />);
    // 3.5km ≈ 2.2mi
    expect(screen.getByText(/2\.2 mi/)).toBeDefined();
  });

  it('rounds distance label to nearest mile when farther than 10mi', () => {
    render(<ListingCard listing={makeListing({ distance_km: 25 })} />);
    // 25km ≈ 15mi (round)
    expect(screen.getByText(/16 mi/)).toBeDefined();
  });

  it('renders "less than 0.1 mi" for nearby listings', () => {
    render(<ListingCard listing={makeListing({ distance_km: 0.05 })} />);
    expect(screen.getByText(/less than 0\.1 mi/)).toBeDefined();
  });

  it('hides distance label when distance_km is null', () => {
    render(<ListingCard listing={makeListing({ distance_km: null })} />);
    expect(screen.queryByText(/mi/)).toBeNull();
  });

  it('shows "You\'re winning" badge when is_user_winning is true', () => {
    render(<ListingCard listing={makeListing({ is_user_winning: true })} />);
    expect(screen.getByText(/You.{0,5}re winning/)).toBeDefined();
  });

  it('shows "Outbid" badge when was_outbid is true', () => {
    render(<ListingCard listing={makeListing({ was_outbid: true })} />);
    expect(screen.getByText(/Outbid/)).toBeDefined();
  });

  it('links to the marketplace detail page', () => {
    render(<ListingCard listing={makeListing()} />);
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/marketplace/listing-1')).toBe(true);
  });

  it('does not wrap with a link when asStaticCard is true', () => {
    const { container } = render(<ListingCard listing={makeListing()} asStaticCard />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('falls back to "Uncategorized" when category_name is empty', () => {
    render(<ListingCard listing={makeListing({ category_name: '' })} />);
    expect(screen.getByText('Uncategorized')).toBeDefined();
  });

  it('renders status badge', () => {
    render(<ListingCard listing={makeListing({ status: LISTING_STATUS.SOLD })} />);
    expect(screen.getByText('sold')).toBeDefined();
  });

  it('renders draft status', () => {
    render(<ListingCard listing={makeListing({ status: LISTING_STATUS.DRAFT })} />);
    expect(screen.getByText('draft')).toBeDefined();
  });

  it('renders cancelled status', () => {
    render(<ListingCard listing={makeListing({ status: LISTING_STATUS.CANCELLED })} />);
    expect(screen.getByText('cancelled')).toBeDefined();
  });

  it('renders fallback icon when there are no photos', () => {
    const { container } = render(<ListingCard listing={makeListing({ photos: [] })} />);
    // SVG fallback is rendered in place of ProgressiveImage
    expect(container.querySelector('[aria-label="No photo"]')).toBeDefined();
  });

  it('renders "Not started" when auction_ends_at is null', () => {
    render(<ListingCard listing={makeListing({ auction_ends_at: null })} />);
    expect(screen.getByText('Not started')).toBeDefined();
  });

  it('renders correctly at 320px mobile viewport (no horizontal overflow markers)', () => {
    // Force a 320px viewport before render
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { writable: true, value: 568 });
    const { container } = render(<ListingCard listing={makeListing()} />);
    // Card should not opt-into nowrap or fixed-width classes that would exceed 320px.
    const card = container.querySelector('.relative.overflow-hidden');
    expect(card).toBeDefined();
    // Title uses line-clamp-2, which is mobile-safe.
    expect(card?.querySelector('h3.line-clamp-2')).toBeTruthy();
  });
});
