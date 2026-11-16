// Behavior tests for the admin markets page: grouping by country / region,
// launch + pull-back confirm flows at market, region and country scope, the
// disabled states that stop no-op bulk actions, and the result toasts.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Market } from '@/types';

import { closest, getDialog, installDialogStub, nth } from './_admin-branch-helpers';
import { withQueryClient } from './_helpers';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => {
      toastSuccess(...args);
    },
    error: (...args: unknown[]) => {
      toastError(...args);
    },
  },
}));

const useAdminMarketsMock = vi.fn();
const setActiveMutateAsync = vi.fn();
const setActiveState = { isPending: false };

vi.mock('@/hooks/useAdmin', () => ({
  useAdminMarkets: () => useAdminMarketsMock() as unknown,
  useSetMarketsActive: () => ({
    mutateAsync: setActiveMutateAsync,
    isPending: setActiveState.isPending,
  }),
}));

import AdminMarketsPage from '@/app/(dashboard)/admin/markets/page';

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: 'm-sf',
    slug: 'sfbay',
    name: 'SF bay area',
    region: 'California',
    region_code: 'CA',
    country: 'US',
    is_active: true,
    lat: null,
    lng: null,
    ...overrides,
  };
}

// 4 markets, 2 live. US: California (1 of 2 live) + a region-less territory.
// MX: one live market with no region.
const SF = makeMarket();
const OAKLAND = makeMarket({ id: 'm-oak', slug: 'oakland', name: 'Oakland', is_active: false });
const PUERTO_RICO = makeMarket({
  id: 'm-pr',
  slug: 'puertorico',
  name: 'Puerto Rico',
  region: null,
  region_code: null,
  is_active: false,
});
const MEXICO_CITY = makeMarket({
  id: 'm-cdmx',
  slug: 'mexicocity',
  name: 'Mexico City',
  region: null,
  region_code: null,
  country: 'MX',
});

function loaded(markets: Market[]) {
  useAdminMarketsMock.mockReturnValue({ data: { markets }, isLoading: false, isError: false });
}

function renderPage() {
  return render(withQueryClient(createElement(AdminMarketsPage)));
}

function marketRow(name: string): HTMLElement {
  return closest(screen.getByText(name), 'li');
}

function country(label: string): HTMLElement {
  return screen.getByRole('region', { name: label });
}

beforeAll(() => {
  installDialogStub();
});

beforeEach(() => {
  vi.clearAllMocks();
  useAdminMarketsMock.mockReset();
  setActiveMutateAsync.mockReset().mockResolvedValue({ updated: 1, active: true });
  setActiveState.isPending = false;
});

describe('AdminMarketsPage — load states', () => {
  it('shows the error state and no market controls when the query fails', () => {
    useAdminMarketsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();

    expect(screen.getByText('Failed to load markets')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Launch all' })).not.toBeInTheDocument();
    expect(screen.queryByText(/markets live/)).not.toBeInTheDocument();
  });

  it('hides the live counter and the empty state while loading', () => {
    useAdminMarketsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPage();

    expect(screen.queryByText(/markets live/)).not.toBeInTheDocument();
    expect(screen.queryByText('No markets in the catalog')).not.toBeInTheDocument();
  });

  it('shows the empty catalog state with a 0 of 0 counter', () => {
    loaded([]);
    renderPage();

    expect(screen.getByText('No markets in the catalog')).toBeInTheDocument();
    expect(screen.getByText('0 of 0 markets live')).toBeInTheDocument();
  });

  it('treats a response without a markets array as an empty catalog', () => {
    useAdminMarketsMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderPage();

    expect(screen.getByText('No markets in the catalog')).toBeInTheDocument();
  });
});

describe('AdminMarketsPage — grouping', () => {
  it('counts live markets overall, per country and per region', () => {
    loaded([SF, OAKLAND, PUERTO_RICO, MEXICO_CITY]);
    renderPage();

    expect(screen.getByText('2 of 4 markets live')).toBeInTheDocument();

    const us = country('United States');
    expect(within(us).getByText('1 / 3 live')).toBeInTheDocument();
    const california = closest(
      within(us).getByRole('heading', { name: 'California' }),
      'div.rounded-lg',
    );
    expect(within(california).getByText('1 / 2 live')).toBeInTheDocument();

    expect(within(country('Mexico')).getAllByText('1 / 1 live')).toHaveLength(2);
  });

  it('files markets with no region under "Other" and offers no region-wide actions there', () => {
    loaded([SF, OAKLAND, PUERTO_RICO]);
    renderPage();

    const us = country('United States');
    const other = closest(within(us).getByRole('heading', { name: 'Other' }), 'div.rounded-lg');
    expect(within(other).getByText('Puerto Rico')).toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: 'Launch all' })).not.toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: 'Pull back all' })).not.toBeInTheDocument();
    // The single-market action is still there.
    expect(within(other).getByRole('button', { name: 'Launch' })).toBeEnabled();
  });

  it('sorts regions and the markets inside each region alphabetically', () => {
    // Deliberately out of order in the API response.
    loaded([PUERTO_RICO, SF, OAKLAND]);
    renderPage();

    const us = country('United States');
    expect(within(us).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'California',
      'Other',
    ]);
    expect(
      within(us)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('span')?.textContent),
    ).toEqual(['Oakland', 'SF bay area', 'Puerto Rico']);
  });

  it('labels each market Live / Not live with the matching single action', () => {
    loaded([SF, OAKLAND]);
    renderPage();

    const live = marketRow('SF bay area');
    expect(within(live).getByText('Live')).toBeInTheDocument();
    expect(within(live).getByRole('button', { name: 'Pull back' })).toBeInTheDocument();

    const notLive = marketRow('Oakland');
    expect(within(notLive).getByText('Not live')).toBeInTheDocument();
    expect(within(notLive).getByRole('button', { name: 'Launch' })).toBeInTheDocument();
  });

  // markets/page.tsx:84-85 — the comment promises "US first, then MX" but
  // `a.country.localeCompare(b.country)` sorts MX ahead of US.
  it.todo('lists the United States before Mexico (source sorts MX first — page.tsx:85)');
});

describe('AdminMarketsPage — disabled bulk actions', () => {
  it('disables "Launch all" when everything in scope is already live', () => {
    loaded([SF, makeMarket({ id: 'm-oak', slug: 'oakland', name: 'Oakland' })]);
    renderPage();

    const us = country('United States');
    const launchAll = within(us).getAllByRole('button', { name: 'Launch all' });
    const pullBackAll = within(us).getAllByRole('button', { name: 'Pull back all' });
    // [0] is the country-wide control, [1] the California one.
    expect(launchAll).toHaveLength(2);
    for (const btn of launchAll) expect(btn).toBeDisabled();
    for (const btn of pullBackAll) expect(btn).toBeEnabled();
  });

  it('disables "Pull back all" when nothing in scope is live', () => {
    loaded([makeMarket({ is_active: false }), OAKLAND]);
    renderPage();

    const us = country('United States');
    for (const btn of within(us).getAllByRole('button', { name: 'Pull back all' })) {
      expect(btn).toBeDisabled();
    }
    for (const btn of within(us).getAllByRole('button', { name: 'Launch all' })) {
      expect(btn).toBeEnabled();
    }
  });

  it('disables every action while an update is in flight', () => {
    setActiveState.isPending = true;
    loaded([SF, OAKLAND]);
    renderPage();

    const us = country('United States');
    for (const btn of within(us).getAllByRole('button')) expect(btn).toBeDisabled();
  });
});

describe('AdminMarketsPage — confirm flows', () => {
  it('launches a single market by slug and reports the singular result', async () => {
    const user = userEvent.setup();
    loaded([SF, OAKLAND]);
    renderPage();
    const dialog = getDialog();
    expect(dialog).not.toHaveAttribute('open');

    await user.click(within(marketRow('Oakland')).getByRole('button', { name: 'Launch' }));

    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).getByRole('heading', { name: 'Launch Oakland?' })).toBeInTheDocument();
    expect(
      within(dialog).getByText('This makes them publicly browseable immediately.'),
    ).toBeInTheDocument();
    expect(setActiveMutateAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Launch' }));

    expect(setActiveMutateAsync).toHaveBeenCalledExactlyOnceWith({
      slugs: ['oakland'],
      active: true,
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Launched 1 market in Oakland');
    });
    expect(dialog).not.toHaveAttribute('open');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('pulls back a single live market with the destructive copy', async () => {
    const user = userEvent.setup();
    setActiveMutateAsync.mockResolvedValue({ updated: 1, active: false });
    loaded([SF, OAKLAND]);
    renderPage();
    const dialog = getDialog();

    await user.click(within(marketRow('SF bay area')).getByRole('button', { name: 'Pull back' }));

    expect(
      within(dialog).getByRole('heading', { name: 'Pull back SF bay area?' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Existing listings are not deleted/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Pull back' }));

    expect(setActiveMutateAsync).toHaveBeenCalledExactlyOnceWith({
      slugs: ['sfbay'],
      active: false,
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Pulled back 1 market in SF bay area');
    });
  });

  it('launches a whole country and pluralises the result from the server count', async () => {
    const user = userEvent.setup();
    setActiveMutateAsync.mockResolvedValue({ updated: 2, active: true });
    loaded([SF, OAKLAND, PUERTO_RICO, MEXICO_CITY]);
    renderPage();
    const dialog = getDialog();

    const us = country('United States');
    await user.click(nth(within(us).getAllByRole('button', { name: 'Launch all' }), 0));

    expect(
      within(dialog).getByRole('heading', { name: 'Launch all 3 markets in United States?' }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Launch' }));

    expect(setActiveMutateAsync).toHaveBeenCalledExactlyOnceWith({ country: 'US', active: true });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Launched 2 markets in United States');
    });
  });

  it('pulls back a whole country', async () => {
    const user = userEvent.setup();
    setActiveMutateAsync.mockResolvedValue({ updated: 1, active: false });
    loaded([SF, OAKLAND, MEXICO_CITY]);
    renderPage();
    const dialog = getDialog();

    const us = country('United States');
    await user.click(nth(within(us).getAllByRole('button', { name: 'Pull back all' }), 0));

    expect(
      within(dialog).getByRole('heading', { name: 'Pull back all 2 markets in United States?' }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Pull back' }));

    expect(setActiveMutateAsync).toHaveBeenCalledExactlyOnceWith({ country: 'US', active: false });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Pulled back 1 market in United States');
    });
  });

  it('launches a region by its region code', async () => {
    const user = userEvent.setup();
    setActiveMutateAsync.mockResolvedValue({ updated: 1, active: true });
    loaded([SF, OAKLAND, PUERTO_RICO]);
    renderPage();
    const dialog = getDialog();

    const us = country('United States');
    await user.click(nth(within(us).getAllByRole('button', { name: 'Launch all' }), 1));

    expect(
      within(dialog).getByRole('heading', { name: 'Launch all 2 markets in California?' }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Launch' }));

    expect(setActiveMutateAsync).toHaveBeenCalledExactlyOnceWith({
      region_code: 'CA',
      active: true,
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Launched 1 market in California');
    });
  });

  it('pulls back a region by its region code', async () => {
    const user = userEvent.setup();
    setActiveMutateAsync.mockResolvedValue({ updated: 2, active: false });
    loaded([SF, makeMarket({ id: 'm-oak', slug: 'oakland', name: 'Oakland' }), PUERTO_RICO]);
    renderPage();
    const dialog = getDialog();

    const us = country('United States');
    await user.click(nth(within(us).getAllByRole('button', { name: 'Pull back all' }), 1));

    expect(
      within(dialog).getByRole('heading', { name: 'Pull back all 2 markets in California?' }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Pull back' }));

    expect(setActiveMutateAsync).toHaveBeenCalledExactlyOnceWith({
      region_code: 'CA',
      active: false,
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Pulled back 2 markets in California');
    });
  });

  it('keeps the dialog open and surfaces the server reason when the update fails', async () => {
    const user = userEvent.setup();
    setActiveMutateAsync.mockRejectedValue(new Error('Market is locked by a migration'));
    loaded([SF, OAKLAND]);
    renderPage();
    const dialog = getDialog();

    await user.click(within(marketRow('Oakland')).getByRole('button', { name: 'Launch' }));
    await user.click(within(dialog).getByRole('button', { name: 'Launch' }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Market is locked by a migration');
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
  });

  it('falls back to a generic message when the failure carries no reason', async () => {
    const user = userEvent.setup();
    setActiveMutateAsync.mockRejectedValue('nope');
    loaded([SF, OAKLAND]);
    renderPage();
    const dialog = getDialog();

    await user.click(within(marketRow('Oakland')).getByRole('button', { name: 'Launch' }));
    await user.click(within(dialog).getByRole('button', { name: 'Launch' }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to update markets');
    });
  });

  it('cancelling closes the dialog without touching any market', async () => {
    const user = userEvent.setup();
    loaded([SF, OAKLAND]);
    renderPage();
    const dialog = getDialog();

    await user.click(within(marketRow('Oakland')).getByRole('button', { name: 'Launch' }));
    expect(dialog).toHaveAttribute('open');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel action' }));

    expect(dialog).not.toHaveAttribute('open');
    expect(setActiveMutateAsync).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
