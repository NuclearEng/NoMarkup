// ScoreboardCard — watch toggle payloads, image fallbacks, condition chip and
// the link's accessible summary. Complements ScoreboardCard.test.tsx.
// MOCKED: useWatchListing (records the listing id + mutate payload),
// next/image, next/link, and the countdown / watcher leaves.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Listing } from '@/types';

const watch = vi.hoisted(() => ({
  mutate: vi.fn<(input: { watching: boolean }) => void>(),
  isPending: false,
  listingIds: [] as string[],
}));

vi.mock('@/hooks/useWatchlist', () => ({
  useWatchListing: (listingId: string) => {
    watch.listingIds.push(listingId);
    return { mutate: watch.mutate, isPending: watch.isPending };
  },
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, priority }: { src: string; alt: string; priority?: boolean }) =>
    createElement('img', { src, alt, 'data-priority': String(Boolean(priority)) }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    'aria-label'?: string;
  }) => createElement('a', { href, 'aria-label': rest['aria-label'] }, children),
}));

vi.mock('@/components/marketplace/CountdownClock', () => ({
  CountdownClock: ({ endsAt }: { endsAt: string | null }) =>
    createElement('span', { 'data-testid': 'countdown' }, endsAt ?? 'no end'),
}));

vi.mock('@/components/marketplace/WatcherBadge', () => ({
  WatcherBadge: ({ count }: { count: number }) =>
    createElement('span', { 'data-testid': 'watchers' }, String(count)),
}));

import { ScoreboardCard } from '@/components/marketplace/ScoreboardCard';

function makeListing(
  over: Partial<Listing & { watcher_count?: number }> = {},
): Listing & { watcher_count?: number } {
  return {
    id: 'listing-1',
    seller_id: 'seller-1',
    category_id: 'cat-furniture',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Walnut credenza',
    description: 'Refinished.',
    status: 'active',
    photos: [{ id: 'p1', url: '/uploads/credenza.jpg', sort_order: 0, blur_hash: null }],
    pickup_zip: '78701',
    pickup_city: 'Austin',
    pickup_state: 'TX',
    pickup_address: null,
    pickup_lat: 30.27,
    pickup_lng: -97.74,
    starting_price_cents: 50_000,
    current_bid_cents: 78_550,
    min_increment_cents: 500,
    bidder_count: 4,
    bid_count: 12,
    auction_duration_hours: 24,
    auction_ends_at: '2026-04-27T12:30:00Z',
    snipe_extension_count: 0,
    distance_km: 1.2,
    is_user_winning: false,
    was_outbid: false,
    created_at: '2026-04-26T12:00:00Z',
    updated_at: '2026-04-27T12:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  watch.mutate.mockReset();
  watch.isPending = false;
  watch.listingIds = [];
});

describe('ScoreboardCard — link summary', () => {
  it('links to the listing and announces title, formatted bid and bid count', () => {
    render(<ScoreboardCard listing={makeListing()} />);
    const link = screen.getByRole('link', {
      name: 'Walnut credenza, current bid $785.50, 12 bids',
    });
    expect(link).toHaveAttribute('href', '/marketplace/listing-1');
    expect(screen.getByText('$785.50')).toBeInTheDocument();
    expect(screen.getByTestId('countdown')).toHaveTextContent('2026-04-27T12:30:00Z');
  });
});

describe('ScoreboardCard — watch heart', () => {
  it('adds an unwatched listing to the watchlist without following the link', () => {
    render(<ScoreboardCard listing={makeListing()} />);
    const heart = screen.getByRole('button', { name: 'Add to watchlist' });
    // preventDefault → the surrounding link must not navigate.
    expect(fireEvent.click(heart)).toBe(false);
    expect(watch.listingIds).toContain('listing-1');
    expect(watch.mutate).toHaveBeenCalledTimes(1);
    expect(watch.mutate).toHaveBeenCalledWith({ watching: true });
  });

  it('does not let the heart click bubble to a card-level click handler', () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick} role="presentation">
        <ScoreboardCard listing={makeListing()} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to watchlist' }));
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('removes a watched listing from the watchlist', () => {
    render(<ScoreboardCard listing={makeListing()} watching />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove from watchlist' }));
    expect(watch.mutate).toHaveBeenCalledWith({ watching: false });
  });

  it('disables the heart while the watch request is in flight', () => {
    watch.isPending = true;
    render(<ScoreboardCard listing={makeListing()} />);
    const heart = screen.getByRole('button', { name: 'Add to watchlist' });
    expect(heart).toBeDisabled();
    fireEvent.click(heart);
    expect(watch.mutate).not.toHaveBeenCalled();
  });
});

describe('ScoreboardCard — hero image', () => {
  it('renders the cover photo, not prioritised by default', () => {
    render(<ScoreboardCard listing={makeListing()} />);
    const img = screen.getByRole('img', { name: 'Walnut credenza' });
    expect(img).toHaveAttribute('src', '/uploads/credenza.jpg');
    expect(img).toHaveAttribute('data-priority', 'false');
  });

  it('prioritises the image when the grid marks it as above the fold', () => {
    render(<ScoreboardCard listing={makeListing()} imagePriority />);
    expect(screen.getByRole('img', { name: 'Walnut credenza' })).toHaveAttribute(
      'data-priority',
      'true',
    );
  });

  it('shows the placeholder instead of an image when the listing has no photos', () => {
    render(<ScoreboardCard listing={makeListing({ photos: [] })} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the placeholder for a photo host next/image is not configured for', () => {
    render(
      <ScoreboardCard
        listing={makeListing({
          photos: [
            {
              id: 'p1',
              url: 'https://unconfigured-host.invalid/x.jpg',
              sort_order: 0,
              blur_hash: null,
            },
          ],
        })}
      />,
    );
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('ScoreboardCard — details row', () => {
  it.each([
    ['new', 'New'],
    ['like_new', 'Like new'],
    ['very_good', 'Very good'],
    ['good', 'Good'],
    ['acceptable', 'Acceptable'],
    ['for_parts', 'For parts'],
  ] satisfies [NonNullable<Listing['condition']>, string][])(
    'labels condition %s as "%s"',
    (condition, label) => {
      render(<ScoreboardCard listing={makeListing({ condition })} />);
      expect(screen.getByLabelText(`Condition: ${label}`)).toHaveTextContent(label);
    },
  );

  it('shows no condition chip when the seller did not say', () => {
    render(<ScoreboardCard listing={makeListing({ condition: null })} />);
    expect(screen.queryByLabelText(/^Condition:/)).toBeNull();
  });

  it('passes zero watchers to the badge when the count is missing', () => {
    render(<ScoreboardCard listing={makeListing({ watcher_count: undefined })} />);
    expect(screen.getByTestId('watchers')).toHaveTextContent('0');
  });

  it('passes the real watcher count through', () => {
    render(<ScoreboardCard listing={makeListing({ watcher_count: 23 })} />);
    expect(screen.getByTestId('watchers')).toHaveTextContent('23');
  });

  it('falls back to the zip when only one of city/state is known', () => {
    render(<ScoreboardCard listing={makeListing({ pickup_state: null })} />);
    expect(screen.getByText('78701')).toBeInTheDocument();
    expect(screen.queryByText(/Austin/)).toBeNull();
  });

  it('shows how many times the close was extended', () => {
    render(<ScoreboardCard listing={makeListing({ snipe_extension_count: 3 })} />);
    expect(screen.getByText('+30s ×3')).toBeInTheDocument();
  });
});
