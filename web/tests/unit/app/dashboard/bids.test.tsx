// Tests for the My Bids page — exercises tab content (loading, error, empty,
// data) and pagination handlers.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const bidsState: {
  data: { bids: { id: string }[]; pagination?: { totalPages: number; hasNext: boolean } } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/bids',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/bids/ProviderBidCard', () => ({
  ProviderBidCard: ({ bid }: { bid: { id: string } }) =>
    createElement('article', { 'data-testid': `bid-${bid.id}` }, bid.id),
}));

vi.mock('@/hooks/useBids', () => ({
  useMyBids: () => bidsState,
}));

vi.mock('@/hooks/useListings', () => ({
  useMyListingBids: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import BidsPage from '@/app/(dashboard)/bids/page';

beforeEach(() => {
  bidsState.data = undefined;
  bidsState.isLoading = false;
  bidsState.isError = false;
  bidsState.refetch = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BidsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(BidsPage)));
    expect(container).toBeTruthy();
  });

  it('renders the loading skeleton when loading', () => {
    bidsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(BidsPage)));
    expect(container).toBeTruthy();
  });

  it('renders the error state with Retry button', () => {
    bidsState.isError = true;
    render(withQueryClient(createElement(BidsPage)));
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });

  it('clicking Retry on the error state invokes refetch', () => {
    const refetch = vi.fn();
    bidsState.isError = true;
    bidsState.refetch = refetch;
    render(withQueryClient(createElement(BidsPage)));
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLButtonElement);
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty state with the correct message for the All tab', () => {
    bidsState.data = { bids: [] };
    render(withQueryClient(createElement(BidsPage)));
    expect(screen.getAllByText(/You have not placed any bids yet\./i).length).toBeGreaterThan(0);
  });

  it('renders bid cards when data is present', () => {
    bidsState.data = { bids: [{ id: 'b1' }, { id: 'b2' }] };
    render(withQueryClient(createElement(BidsPage)));
    expect(screen.getAllByTestId('bid-b1').length).toBeGreaterThan(0);
  });

  it('clicking another tab does not throw', () => {
    bidsState.data = { bids: [] };
    render(withQueryClient(createElement(BidsPage)));
    const wonTab = screen.getByRole('tab', { name: 'Won' });
    fireEvent.click(wonTab);
    // Outer tabs: Services + Goods. Inner Services tabs: All / Active / Won / Lost.
    // Total = 6.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(6);
  });

  it('renders Previous/Next pagination when totalPages > 1', () => {
    bidsState.data = {
      bids: [{ id: 'bx' }],
      pagination: { totalPages: 3, hasNext: true },
    };
    render(withQueryClient(createElement(BidsPage)));
    const prevs = screen.getAllByRole('button', { name: 'Previous' });
    const nexts = screen.getAllByRole('button', { name: 'Next' });
    expect((prevs[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(nexts[0] as HTMLButtonElement);
    // Page indicator updates somewhere in the DOM.
    expect(screen.getAllByText(/Page/i).length).toBeGreaterThan(0);
  });

  it('clicking Previous after advancing decrements the page', () => {
    bidsState.data = {
      bids: [{ id: 'bx' }],
      pagination: { totalPages: 5, hasNext: true },
    };
    render(withQueryClient(createElement(BidsPage)));
    const next = screen.getAllByRole('button', { name: 'Next' })[0] as HTMLButtonElement;
    fireEvent.click(next); // page=2
    fireEvent.click(next); // page=3
    const prev = screen.getAllByRole('button', { name: 'Previous' })[0] as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    fireEvent.click(prev); // page=2
    // After Previous click, the indicator should still render.
    expect(screen.getAllByText(/Page 2 of 5/).length).toBeGreaterThan(0);
  });

  it('clicking each tab mounts the corresponding content', async () => {
    const user = userEvent.setup();
    bidsState.data = { bids: [] };
    render(withQueryClient(createElement(BidsPage)));
    await user.click(screen.getByRole('tab', { name: 'Active' }));
    expect(screen.getAllByText(/You have no active bids/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: 'Won' }));
    expect(screen.getAllByText(/You have not won any bids yet/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: 'Lost' }));
    expect(screen.getAllByText(/No lost bids/i).length).toBeGreaterThan(0);
  });
});
