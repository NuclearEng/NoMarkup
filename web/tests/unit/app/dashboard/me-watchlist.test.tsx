// /me/watchlist page — covers loading, error, empty, and success states.
// The watchlist hook was orphaned before this page existed (Bug 1b).
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const watchlistState: {
  data: { listings: { id: string; title: string }[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/me/watchlist',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: () => watchlistState,
}));

vi.mock('@/components/marketplace/ScoreboardCard', () => ({
  ScoreboardCard: ({
    listing,
    watching,
  }: {
    listing: { id: string; title: string };
    watching?: boolean;
  }) =>
    createElement(
      'article',
      { 'data-testid': `listing-${listing.id}`, 'data-watching': String(Boolean(watching)) },
      listing.title,
    ),
}));

import WatchlistPage from '@/app/(dashboard)/me/watchlist/page';

function renderPage() {
  return render(withQueryClient(createElement(WatchlistPage)));
}

beforeEach(() => {
  watchlistState.data = undefined;
  watchlistState.isLoading = false;
  watchlistState.isError = false;
  watchlistState.refetch = vi.fn();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('WatchlistPage', () => {
  it('renders skeletons while loading', () => {
    watchlistState.isLoading = true;
    const { container } = renderPage();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the error state and Retry invokes refetch', () => {
    const refetch = vi.fn();
    watchlistState.isError = true;
    watchlistState.refetch = refetch;
    renderPage();
    expect(screen.getByText(/Failed to load your watchlist/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty state when there are no watched listings', () => {
    watchlistState.data = { listings: [] };
    renderPage();
    expect(screen.getByText(/Nothing on your watchlist yet/i)).toBeDefined();
  });

  it('renders watched listings as cards with watching=true', () => {
    watchlistState.data = { listings: [{ id: 'x', title: 'Watched item' }] };
    renderPage();
    const card = screen.getByTestId('listing-x');
    expect(card.getAttribute('data-watching')).toBe('true');
  });
});
