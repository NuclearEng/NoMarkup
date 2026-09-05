// My listings page — covers tabs, loading/error/empty/data states.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const myListingsState: {
  data:
    | {
        listings: { id: string; title: string; bid_count: number }[];
        pagination?: { totalPages: number; hasNext: boolean };
      }
    | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = {
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const deleteDraft = { mutate: vi.fn(), isPending: false };
const cancelListing = { mutate: vi.fn(), isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sell/mine',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/marketplace/ListingCard', () => ({
  ListingCard: ({ listing }: { listing: { id: string; title: string } }) =>
    createElement('article', { 'data-testid': `listing-${listing.id}` }, listing.title),
}));

vi.mock('@/hooks/useListings', () => ({
  useMyListings: () => myListingsState,
  useDeleteListingDraft: () => deleteDraft,
  useCancelListing: () => cancelListing,
}));

import SellMinePage from '@/app/(dashboard)/sell/mine/page';

beforeEach(() => {
  myListingsState.data = undefined;
  myListingsState.isLoading = false;
  myListingsState.isError = false;
  myListingsState.refetch = vi.fn();
  deleteDraft.mutate = vi.fn();
  cancelListing.mutate = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SellMinePage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(SellMinePage)));
    expect(container).toBeTruthy();
  });

  it('renders the new listing CTA', () => {
    render(withQueryClient(createElement(SellMinePage)));
    const links = screen.getAllByText(/New listing|Start a listing/i);
    expect(links.length).toBeGreaterThan(0);
  });

  it('renders 4 tabs (Active / Sold / Drafts / Cancelled)', () => {
    myListingsState.data = { listings: [] };
    render(withQueryClient(createElement(SellMinePage)));
    expect(screen.getByRole('tab', { name: 'Active' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Sold' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Drafts' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Cancelled' })).toBeDefined();
  });

  it('renders the empty state for active tab when no listings', () => {
    myListingsState.data = { listings: [] };
    render(withQueryClient(createElement(SellMinePage)));
    expect(screen.getByText(/no active listings yet/i)).toBeDefined();
  });

  it('renders the error state with Retry', () => {
    myListingsState.isError = true;
    render(withQueryClient(createElement(SellMinePage)));
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });

  it('renders listing cards when data has listings', () => {
    myListingsState.data = {
      listings: [{ id: 'a', title: 'Sofa', bid_count: 0 }],
    };
    render(withQueryClient(createElement(SellMinePage)));
    expect(screen.getByTestId('listing-a')).toBeDefined();
  });

  it('shows Cancel button on active listings with no bids', () => {
    myListingsState.data = {
      listings: [{ id: 'a', title: 'Sofa', bid_count: 0 }],
    };
    render(withQueryClient(createElement(SellMinePage)));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('hides Cancel button on active listings with bids', () => {
    myListingsState.data = {
      listings: [{ id: 'a', title: 'Sofa', bid_count: 3 }],
    };
    render(withQueryClient(createElement(SellMinePage)));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('clicking Retry on error invokes refetch', () => {
    const refetch = vi.fn();
    myListingsState.isError = true;
    myListingsState.refetch = refetch;
    render(withQueryClient(createElement(SellMinePage)));
    const retry = screen.getAllByRole('button', { name: 'Retry' })[0];
    if (!retry) throw new Error('expected Retry button');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalled();
  });
});
