// /marketplace/[id]/replay — thin client page around the replay player.
// MOCKED: useParams, useListing, the AuctionReplay component, next/link.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeParams = { id: 'l-77' };
const listingState: { data: { title: string } | undefined } = { data: undefined };
const requestedListingIds: string[] = [];

vi.mock('next/navigation', () => ({
  useParams: () => routeParams,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useListings', () => ({
  useListing: (id: string) => {
    requestedListingIds.push(id);
    return listingState;
  },
}));

vi.mock('@/components/marketplace/AuctionReplay', () => ({
  AuctionReplay: ({ listingId }: { listingId: string }) =>
    createElement('div', { 'data-testid': 'replay', 'data-listing-id': listingId }),
}));

import ListingReplayPage from '@/app/(public)/marketplace/[id]/replay/page';

beforeEach(() => {
  routeParams.id = 'l-77';
  listingState.data = undefined;
  requestedListingIds.length = 0;
});

describe('ListingReplayPage', () => {
  it('replays the listing named in the route', () => {
    render(<ListingReplayPage />);
    expect(screen.getByTestId('replay')).toHaveAttribute('data-listing-id', 'l-77');
    expect(requestedListingIds).toContain('l-77');
  });

  it('links back to that listing', () => {
    routeParams.id = 'abc';
    render(<ListingReplayPage />);
    expect(screen.getByRole('link', { name: 'Back to listing' })).toHaveAttribute(
      'href',
      '/marketplace/abc',
    );
  });

  it('shows the listing title under the heading once it has loaded', () => {
    listingState.data = { title: 'Oak dining table' };
    render(<ListingReplayPage />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Auction Replay' });
    expect(heading.nextElementSibling).toHaveTextContent('Oak dining table');
  });

  it('keeps a non-empty subtitle slot while the listing is still loading', () => {
    render(<ListingReplayPage />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Auction Replay' });
    const subtitle = heading.nextElementSibling;
    expect(subtitle?.tagName).toBe('P');
    // A non-breaking space holds the line so the title does not shift layout.
    expect(subtitle?.textContent).toBe(' ');
    expect(screen.getByTestId('replay')).toBeInTheDocument();
  });
});
