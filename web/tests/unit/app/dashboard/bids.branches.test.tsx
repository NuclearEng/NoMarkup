// Branch tests for the My Bids page beyond bids.test.tsx: the provider role
// guard on the Services half, the status filter each sub-tab queries with, the
// per-tab empty copy, and the Goods tab (loading / error / empty / list /
// pagination) which the existing file stubs out.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { USER_ROLE } from '@/types';

interface Pagination {
  totalPages: number;
  hasNext: boolean;
}

interface ServicesQuery {
  data: { bids: { id: string }[]; pagination?: Pagination } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

interface GoodsQuery {
  data: { bids: { bid: { id: string } }[]; pagination?: Pagination } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

const h = vi.hoisted(() => ({
  user: null as { id: string; roles: string[] } | null,
  services: undefined as unknown,
  servicesCalls: [] as [string | undefined, number][],
  goods: undefined as unknown,
  goodsCalls: [] as number[],
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/bids/ProviderBidCard', () => ({
  ProviderBidCard: ({ bid }: { bid: { id: string } }) =>
    createElement('article', { 'data-testid': 'service-bid' }, bid.id),
}));

vi.mock('@/components/marketplace/MyListingBidCard', () => ({
  MyListingBidCard: ({ entry }: { entry: { bid: { id: string } } }) =>
    createElement('article', { 'data-testid': 'goods-bid' }, entry.bid.id),
}));

vi.mock('@/components/ui/content-loader', () => ({
  ContentLoader: ({ preset }: { preset: string }) =>
    createElement('div', { 'data-testid': `loader-${preset}` }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: <T,>(selector: (state: { user: typeof h.user }) => T): T =>
    selector({ user: h.user }),
}));

vi.mock('@/hooks/useBids', () => ({
  useMyBids: (status: string | undefined, page: number) => {
    h.servicesCalls.push([status, page]);
    return h.services;
  },
}));

vi.mock('@/hooks/useListings', () => ({
  useMyListingBids: (page: number) => {
    h.goodsCalls.push(page);
    return h.goods;
  },
}));

const { default: MyBidsPage } = await import('@/app/(dashboard)/bids/page');

function servicesQuery(overrides: Partial<ServicesQuery> = {}): ServicesQuery {
  return { data: undefined, isLoading: false, isError: false, refetch: vi.fn(), ...overrides };
}

function goodsQuery(overrides: Partial<GoodsQuery> = {}): GoodsQuery {
  return { data: undefined, isLoading: false, isError: false, refetch: vi.fn(), ...overrides };
}

function renderPage() {
  return render(createElement(MyBidsPage));
}

async function openTab(name: string) {
  await userEvent.click(screen.getByRole('tab', { name }));
  return screen.getByRole('tabpanel', { name });
}

beforeEach(() => {
  h.user = { id: 'u-1', roles: [USER_ROLE.PROVIDER] };
  h.services = servicesQuery();
  h.goods = goodsQuery();
  h.servicesCalls.length = 0;
  h.goodsCalls.length = 0;
});

describe('MyBidsPage — provider role guard', () => {
  it.each([
    ['a customer-only account', { id: 'u-2', roles: [USER_ROLE.CUSTOMER] }],
    ['a signed-out visitor', null],
  ])('replaces the services sub-tabs with a notice for %s', (_label, user) => {
    h.user = user;
    renderPage();
    expect(
      screen.getByText(/Services bids are only available to provider accounts\./),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Services', 'Goods']);
    // The provider-only bids endpoint is never queried.
    expect(h.servicesCalls).toHaveLength(0);
  });

  it('still lets a non-provider reach their goods bids', async () => {
    h.user = { id: 'u-2', roles: [USER_ROLE.CUSTOMER] };
    h.goods = goodsQuery({ data: { bids: [{ bid: { id: 'gb-1' } }] } });
    renderPage();
    const panel = await openTab('Goods');
    expect(within(panel).getByTestId('goods-bid')).toHaveTextContent('gb-1');
    expect(h.servicesCalls).toHaveLength(0);
  });

  it('shows all four status sub-tabs to a provider who is also a customer', () => {
    h.user = { id: 'u-3', roles: [USER_ROLE.CUSTOMER, USER_ROLE.PROVIDER] };
    renderPage();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Services',
      'Goods',
      'All',
      'Active',
      'Won',
      'Lost',
    ]);
    expect(screen.queryByText(/only available to provider accounts/)).not.toBeInTheDocument();
  });
});

describe('MyBidsPage — services sub-tabs', () => {
  it('queries the unfiltered first page on the default All tab', () => {
    renderPage();
    expect(h.servicesCalls.at(-1)).toEqual([undefined, 1]);
  });

  it.each([
    ['Active', 'active', 'You have no active bids.'],
    ['Won', 'awarded', 'You have not won any bids yet.'],
    ['Lost', 'not_selected', 'No lost bids.'],
  ])('the %s tab filters by status "%s" and has its own empty copy', async (tab, status, copy) => {
    h.services = servicesQuery({ data: { bids: [] } });
    renderPage();
    const panel = await openTab(tab);
    expect(h.servicesCalls.at(-1)).toEqual([status, 1]);
    expect(within(panel).getByText(copy)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Browse Jobs' })).toHaveAttribute('href', '/jobs');
  });

  it('shows the loader while service bids load', () => {
    h.services = servicesQuery({ isLoading: true });
    renderPage();
    expect(screen.getByTestId('loader-bid-card')).toBeInTheDocument();
    expect(screen.queryByText('No bids')).not.toBeInTheDocument();
  });

  it('pages forward and back, requesting each page with the tab filter', async () => {
    h.services = servicesQuery({
      data: { bids: [{ id: 'b-1' }], pagination: { totalPages: 3, hasNext: true } },
    });
    renderPage();
    const panel = await openTab('Active');
    const previous = within(panel).getByRole('button', { name: 'Previous' });
    const next = within(panel).getByRole('button', { name: 'Next' });
    expect(previous).toBeDisabled();
    expect(within(panel).getByText('Page 1 of 3')).toBeInTheDocument();

    await userEvent.click(next);
    expect(within(panel).getByText('Page 2 of 3')).toBeInTheDocument();
    expect(h.servicesCalls.at(-1)).toEqual(['active', 2]);
    expect(previous).toBeEnabled();

    await userEvent.click(previous);
    expect(within(panel).getByText('Page 1 of 3')).toBeInTheDocument();
    expect(h.servicesCalls.at(-1)).toEqual(['active', 1]);
  });

  it('disables Next on the last page', () => {
    h.services = servicesQuery({
      data: { bids: [{ id: 'b-1' }], pagination: { totalPages: 2, hasNext: false } },
    });
    renderPage();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it.each<[string, Pagination | undefined]>([
    ['a single page', { totalPages: 1, hasNext: false }],
    ['no pagination block', undefined],
  ])('hides the pager for %s', (_label, pagination) => {
    h.services = servicesQuery({ data: { bids: [{ id: 'b-1' }], pagination } });
    renderPage();
    expect(screen.getByTestId('service-bid')).toHaveTextContent('b-1');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Page /)).not.toBeInTheDocument();
  });
});

describe('MyBidsPage — goods tab', () => {
  it('queries the first page of listing bids and shows the loader while loading', async () => {
    h.goods = goodsQuery({ isLoading: true });
    renderPage();
    const panel = await openTab('Goods');
    expect(within(panel).getByTestId('loader-bid-card')).toBeInTheDocument();
    expect(h.goodsCalls.at(-1)).toBe(1);
  });

  it('retries the listing-bids query from the error state', async () => {
    const query = goodsQuery({ isError: true });
    h.goods = query;
    renderPage();
    const panel = await openTab('Goods');
    expect(within(panel).getByText('Failed to load bids')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it.each<[string, GoodsQuery['data']]>([
    ['an empty list', { bids: [] }],
    ['no data at all', undefined],
  ])('points to the marketplace for %s', async (_label, data) => {
    h.goods = goodsQuery({ data });
    renderPage();
    const panel = await openTab('Goods');
    expect(within(panel).getByText('No goods bids')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Browse marketplace' })).toHaveAttribute(
      'href',
      '/marketplace',
    );
  });

  it('renders one card per listing bid without a pager for a single page', async () => {
    h.goods = goodsQuery({
      data: {
        bids: [{ bid: { id: 'gb-1' } }, { bid: { id: 'gb-2' } }],
        pagination: { totalPages: 1, hasNext: false },
      },
    });
    renderPage();
    const panel = await openTab('Goods');
    expect(within(panel).getAllByTestId('goods-bid').map((c) => c.textContent)).toEqual([
      'gb-1',
      'gb-2',
    ]);
    expect(within(panel).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('pages through listing bids and stops at the last page', async () => {
    h.goods = goodsQuery({
      data: { bids: [{ bid: { id: 'gb-1' } }], pagination: { totalPages: 2, hasNext: true } },
    });
    const view = renderPage();
    const panel = await openTab('Goods');
    expect(within(panel).getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(within(panel).getByText('Page 1 of 2')).toBeInTheDocument();

    // Page 2 is the last one: the server reports no further page.
    h.goods = goodsQuery({
      data: { bids: [{ bid: { id: 'gb-9' } }], pagination: { totalPages: 2, hasNext: false } },
    });
    await userEvent.click(within(panel).getByRole('button', { name: 'Next' }));
    expect(h.goodsCalls.at(-1)).toBe(2);
    expect(within(panel).getByText('Page 2 of 2')).toBeInTheDocument();
    expect(within(panel).getByTestId('goods-bid')).toHaveTextContent('gb-9');
    expect(within(panel).getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(within(panel).getByRole('button', { name: 'Previous' }));
    expect(h.goodsCalls.at(-1)).toBe(1);
    expect(within(panel).getByText('Page 1 of 2')).toBeInTheDocument();
    view.unmount();
  });
});
