// /me/feed — followed sellers' auctions. Covers loading, error + retry,
// empty (undefined and []) and populated states, which are mutually exclusive.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

interface FeedListing {
  id: string;
  title: string;
}

const feedState: {
  data: { listings: FeedListing[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useFollows', () => ({
  useMyFeed: () => feedState,
}));

vi.mock('@/components/marketplace/ListingCard', () => ({
  ListingCard: ({ listing }: { listing: FeedListing }) =>
    createElement('article', { 'data-testid': `listing-${listing.id}` }, listing.title),
}));

import MyFeedPage from '@/app/(dashboard)/me/feed/page';

function renderPage() {
  return render(withQueryClient(createElement(MyFeedPage)));
}

beforeEach(() => {
  vi.clearAllMocks();
  feedState.data = undefined;
  feedState.isLoading = false;
  feedState.isError = false;
  feedState.refetch = vi.fn();
});

describe('MyFeedPage', () => {
  it('shows only the loading status while loading, even if stale data or an error exists', () => {
    feedState.isLoading = true;
    feedState.isError = true;
    feedState.data = { listings: [{ id: 'a', title: 'Stale' }] };
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading feed' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No activity yet')).toBeNull();
    expect(screen.queryByTestId('listing-a')).toBeNull();
  });

  it('shows the error alert, hides the empty state, and Retry calls refetch', () => {
    const refetch = vi.fn();
    feedState.isError = true;
    feedState.refetch = refetch;
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load your feed.');
    expect(screen.queryByText('No activity yet')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not render cached listings underneath an error', () => {
    feedState.isError = true;
    feedState.data = { listings: [{ id: 'a', title: 'Cached' }] };
    renderPage();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('listing-a')).toBeNull();
  });

  it('shows the empty state when the query settled without data', () => {
    renderPage();

    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    // Header link + empty-state CTA both point at the marketplace.
    const links = screen.getAllByRole('link', { name: 'Browse marketplace' });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/marketplace');
    }
  });

  it('shows the empty state for an empty listings array', () => {
    feedState.data = { listings: [] };
    renderPage();

    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders one card per listing in the order the API returned them', () => {
    feedState.data = {
      listings: [
        { id: 'soon', title: 'Closing soon' },
        { id: 'later', title: 'Closing later' },
      ],
    };
    renderPage();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Closing soon');
    expect(items[1]).toHaveTextContent('Closing later');
    expect(screen.getByTestId('listing-soon')).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).toBeNull();
    // Only the header link remains once the empty-state CTA is gone.
    expect(screen.getAllByRole('link', { name: 'Browse marketplace' })).toHaveLength(1);
  });
});
