import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScoreboardCard } from '@/components/marketplace/ScoreboardCard';
import type { Listing } from '@/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function withQueryClient(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const baseListing: Listing & { watcher_count?: number } = {
  id: 'listing-1',
  seller_id: 'seller-1',
  category_id: 'cat-furniture',
  category_name: 'Furniture',
  category_slug: 'furniture',
  title: 'Mid-century walnut credenza — restored',
  description: 'Refinished, beautiful.',
  status: 'active',
  photos: [
    {
      id: 'p1',
      url: 'https://picsum.photos/seed/listing1/800/600',
      sort_order: 0,
      blur_hash: null,
    },
  ],
  pickup_zip: '78701',
  pickup_city: 'Austin',
  pickup_state: 'TX',
  pickup_address: null,
  pickup_lat: 30.27,
  pickup_lng: -97.74,
  starting_price_cents: 50_000,
  current_bid_cents: 78_500,
  min_increment_cents: 500,
  bidder_count: 4,
  bid_count: 12,
  auction_duration_hours: 24,
  auction_ends_at: '2026-04-27T12:30:00Z',
  snipe_extension_count: 0,
  distance_km: 1.2,
  is_user_winning: false,
  was_outbid: false,
  watcher_count: 23,
  created_at: '2026-04-26T12:00:00Z',
  updated_at: '2026-04-27T12:00:00Z',
};

describe('ScoreboardCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders title, current bid, watcher count, and city/state', () => {
    render(withQueryClient(<ScoreboardCard listing={baseListing} urgency="urgent" />));
    expect(screen.getByText(baseListing.title)).toBeDefined();
    expect(screen.getByText('$785.00')).toBeDefined();
    expect(screen.getByText('23')).toBeDefined();
    expect(screen.getByText('Austin, TX')).toBeDefined();
    expect(screen.getByText('12 bids')).toBeDefined();
  });

  it('shows the "Ending now" ribbon for critical urgency', () => {
    render(withQueryClient(<ScoreboardCard listing={baseListing} urgency="critical" />));
    expect(screen.getByText('Ending now')).toBeDefined();
  });

  it('shows the "Closing soon" ribbon for urgent urgency', () => {
    render(withQueryClient(<ScoreboardCard listing={baseListing} urgency="urgent" />));
    expect(screen.getByText('Closing soon')).toBeDefined();
  });

  it('does not show the urgency ribbon for normal urgency', () => {
    render(withQueryClient(<ScoreboardCard listing={baseListing} />));
    expect(screen.queryByText('Closing soon')).toBeNull();
    expect(screen.queryByText('Ending now')).toBeNull();
  });

  it('shows snipe-extension badge when extensions > 0', () => {
    render(
      withQueryClient(
        <ScoreboardCard
          listing={{ ...baseListing, snipe_extension_count: 2 }}
          urgency="critical"
        />,
      ),
    );
    expect(screen.getByText('+30s ×2')).toBeDefined();
  });

  it('falls back to zip code when city/state are missing', () => {
    render(
      withQueryClient(
        <ScoreboardCard
          listing={{ ...baseListing, pickup_city: null, pickup_state: null }}
        />,
      ),
    );
    expect(screen.getByText('78701')).toBeDefined();
  });

  it('omits the watcher badge when count is zero or missing', () => {
    const { container } = render(
      withQueryClient(<ScoreboardCard listing={{ ...baseListing, watcher_count: 0 }} />),
    );
    expect(container.querySelector('[aria-label*="watching"]')).toBeNull();
  });

  it('uses singular "bid" when bid_count is 1', () => {
    render(withQueryClient(<ScoreboardCard listing={{ ...baseListing, bid_count: 1 }} />));
    expect(screen.getByText('1 bid')).toBeDefined();
  });

  // Bug 1 — the watch heart must reflect the passed-in state, not always
  // default to "not watching".
  it('reflects watching=true on the heart (filled, aria-pressed, remove label)', () => {
    render(withQueryClient(<ScoreboardCard listing={baseListing} watching />));
    const heart = screen.getByRole('button', { name: /Remove from watchlist/i });
    expect(heart.getAttribute('aria-pressed')).toBe('true');
  });

  it('reflects watching=false on the heart (add label, aria-pressed=false)', () => {
    render(withQueryClient(<ScoreboardCard listing={baseListing} watching={false} />));
    const heart = screen.getByRole('button', { name: /Add to watchlist/i });
    expect(heart.getAttribute('aria-pressed')).toBe('false');
  });

  it('hides the watch heart entirely when showWatch=false (logged-out)', () => {
    render(withQueryClient(<ScoreboardCard listing={baseListing} showWatch={false} />));
    expect(screen.queryByRole('button', { name: /watchlist/i })).toBeNull();
  });

  it('shows the watch heart by default (showWatch defaults to true)', () => {
    render(withQueryClient(<ScoreboardCard listing={baseListing} />));
    expect(screen.getByRole('button', { name: /Add to watchlist/i })).toBeDefined();
  });
});
