// Behavior tests for the admin goods-listings moderation page: row rendering
// fallbacks, the suspend / reactivate / cancel confirm flows (reason gating and
// the mutation each one calls), search, status filter and pagination mapping.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminListing } from '@/hooks/useAdmin';

import { closest, getDialog, installDialogStub } from './_admin-branch-helpers';
import { withQueryClient } from './_helpers';

vi.mock('@/components/ui/select', () => import('./_native-select-mock'));

const useAdminListingsMock = vi.fn();
const suspendMutateAsync = vi.fn();
const reactivateMutateAsync = vi.fn();
const cancelMutateAsync = vi.fn();
const pending = { suspend: false, reactivate: false, cancel: false };

vi.mock('@/hooks/useAdmin', () => ({
  useAdminListings: (...args: unknown[]) => useAdminListingsMock(...args) as unknown,
  useSuspendListing: () => ({ mutateAsync: suspendMutateAsync, isPending: pending.suspend }),
  useReactivateListing: () => ({
    mutateAsync: reactivateMutateAsync,
    isPending: pending.reactivate,
  }),
  useCancelListing: () => ({ mutateAsync: cancelMutateAsync, isPending: pending.cancel }),
}));

import AdminListingsPage from '@/app/(dashboard)/admin/listings/page';

function makeListing(overrides: Partial<AdminListing> = {}): AdminListing {
  return {
    id: 'l-1',
    title: 'Vintage Drill Press',
    seller_id: 'seller-abcdef-123456',
    seller_email: 'seller@example.com',
    status: 'active',
    is_hidden: false,
    starting_price_cents: 5000,
    current_bid_cents: 7500,
    bid_count: 3,
    open_report_count: 0,
    auction_ends_at: '2026-07-04T12:00:00Z',
    created_at: '2026-06-01T12:00:00Z',
    ...overrides,
  };
}

function loaded(
  listings: AdminListing[],
  pagination: { page: number; page_size: number; total: number } | undefined = {
    page: 1,
    page_size: 20,
    total: listings.length,
  },
) {
  useAdminListingsMock.mockReturnValue({
    data: { listings, pagination },
    isLoading: false,
    isError: false,
  });
}

function renderPage() {
  return render(withQueryClient(createElement(AdminListingsPage)));
}

function row(title: string): HTMLElement {
  return closest(screen.getByText(title), 'tr');
}

beforeAll(() => {
  installDialogStub();
});

beforeEach(() => {
  vi.clearAllMocks();
  useAdminListingsMock.mockReset();
  suspendMutateAsync.mockReset().mockResolvedValue(undefined);
  reactivateMutateAsync.mockReset().mockResolvedValue(undefined);
  cancelMutateAsync.mockReset().mockResolvedValue(undefined);
  pending.suspend = false;
  pending.reactivate = false;
  pending.cancel = false;
});

describe('AdminListingsPage — load states', () => {
  it('queries the first page of 20 with no filters by default', () => {
    loaded([]);
    renderPage();

    expect(useAdminListingsMock).toHaveBeenLastCalledWith({
      status: undefined,
      q: undefined,
      page: 1,
      page_size: 20,
    });
  });

  it('shows the error state instead of the table when the query fails', () => {
    useAdminListingsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();

    expect(screen.getByText('Failed to load listings')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search listings')).not.toBeInTheDocument();
  });

  it('shows skeleton rows rather than the empty message while loading', () => {
    useAdminListingsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPage();

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(
      screen.queryByText('No listings found matching the current filters.'),
    ).not.toBeInTheDocument();
  });

  it('shows the empty message when no listing matches', () => {
    loaded([]);
    renderPage();

    expect(screen.getByText('No listings found matching the current filters.')).toBeInTheDocument();
  });
});

describe('AdminListingsPage — rows', () => {
  it('shows seller email, current bid, starting price, bid count and end date', () => {
    loaded([makeListing()]);
    renderPage();

    const r = row('Vintage Drill Press');
    expect(within(r).getByText('Seller: seller@example.com')).toBeInTheDocument();
    expect(within(r).getByText('$75.00')).toBeInTheDocument();
    expect(within(r).getByText('start: $50.00')).toBeInTheDocument();
    expect(within(r).getByText('3')).toBeInTheDocument();
    expect(within(r).getByText('Jul 4, 2026')).toBeInTheDocument();
    expect(within(r).queryByText('Hidden')).not.toBeInTheDocument();
    expect(within(r).queryByText(/report/)).not.toBeInTheDocument();
  });

  it('falls back to a short seller id when the email is missing', () => {
    loaded([makeListing({ seller_email: '' })]);
    renderPage();

    expect(screen.getByText('Seller: seller-a')).toBeInTheDocument();
  });

  it.each([
    ['no bid yet (null)', null],
    ['no bid yet (omitted)', undefined],
    ['a zero bid', 0],
  ])('shows "--" for the current bid with %s', (_label, bid) => {
    loaded([makeListing({ current_bid_cents: bid })]);
    renderPage();

    expect(within(row('Vintage Drill Press')).getByText('--')).toBeInTheDocument();
  });

  it('badges hidden listings and pluralises the open report count', () => {
    loaded([
      makeListing({ id: 'l-1', title: 'One report', open_report_count: 1 }),
      makeListing({ id: 'l-2', title: 'Two reports', open_report_count: 2, is_hidden: true }),
    ]);
    renderPage();

    const one = row('One report');
    expect(within(one).getByText('1 report')).toBeInTheDocument();
    expect(within(one).queryByText('Hidden')).not.toBeInTheDocument();

    const two = row('Two reports');
    expect(within(two).getByText('2 reports')).toBeInTheDocument();
    expect(within(two).getByText('Hidden')).toBeInTheDocument();
  });

  it('offers Reactivate for hidden listings and Suspend for visible ones', () => {
    loaded([
      makeListing({ id: 'l-1', title: 'Visible' }),
      makeListing({ id: 'l-2', title: 'Hidden one', is_hidden: true }),
    ]);
    renderPage();

    expect(screen.getByRole('button', { name: 'Suspend listing: Visible' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reactivate listing: Visible' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reactivate listing: Hidden one' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Suspend listing: Hidden one' }),
    ).not.toBeInTheDocument();
  });

  it('disables Cancel only for listings that are already cancelled', () => {
    loaded([
      makeListing({ id: 'l-1', title: 'Live one' }),
      makeListing({ id: 'l-2', title: 'Dead one', status: 'cancelled' }),
    ]);
    renderPage();

    expect(screen.getByRole('button', { name: 'Cancel listing: Live one' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel listing: Dead one' })).toBeDisabled();
  });
});

describe('AdminListingsPage — moderation actions', () => {
  it('suspend requires a reason, then calls the suspend mutation and closes', async () => {
    const user = userEvent.setup();
    loaded([makeListing({ id: 'l-9' })]);
    const { container } = renderPage();
    const dialog = getDialog(container);
    expect(dialog).not.toHaveAttribute('open');

    await user.click(screen.getByRole('button', { name: 'Suspend listing: Vintage Drill Press' }));

    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).getByRole('heading', { name: 'Suspend Listing' })).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Suspend "Vintage Drill Press"? It will be hidden from the public marketplace.',
      ),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Suspend Listing' });
    expect(confirm).toBeDisabled();

    // Whitespace is not a reason.
    await user.type(within(dialog).getByLabelText('Reason'), '   ');
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Reason'), 'stolen goods');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(suspendMutateAsync).toHaveBeenCalledExactlyOnceWith({
      listingId: 'l-9',
      reason: '   stolen goods',
    });
    expect(cancelMutateAsync).not.toHaveBeenCalled();
    expect(reactivateMutateAsync).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute('open');
    });
  });

  it('reactivate needs no reason and calls the reactivate mutation', async () => {
    const user = userEvent.setup();
    loaded([makeListing({ id: 'l-5', is_hidden: true })]);
    const { container } = renderPage();
    const dialog = getDialog(container);

    await user.click(
      screen.getByRole('button', { name: 'Reactivate listing: Vintage Drill Press' }),
    );

    expect(within(dialog).getByRole('heading', { name: 'Reactivate Listing' })).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Reactivate "Vintage Drill Press"? It will appear in the public marketplace again.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Reason')).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Reactivate Listing' });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(reactivateMutateAsync).toHaveBeenCalledExactlyOnceWith({ listingId: 'l-5' });
    expect(suspendMutateAsync).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute('open');
    });
  });

  it('force-cancel requires a reason and calls the cancel mutation', async () => {
    const user = userEvent.setup();
    loaded([makeListing({ id: 'l-3' })]);
    const { container } = renderPage();
    const dialog = getDialog(container);

    await user.click(screen.getByRole('button', { name: 'Cancel listing: Vintage Drill Press' }));

    expect(within(dialog).getByRole('heading', { name: 'Cancel Listing' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Active bids will be invalidated/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Cancel Listing' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Reason'), 'prohibited item');
    await user.click(confirm);

    expect(cancelMutateAsync).toHaveBeenCalledExactlyOnceWith({
      listingId: 'l-3',
      reason: 'prohibited item',
    });
    expect(suspendMutateAsync).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute('open');
    });
  });

  it('dismissing the dialog discards the typed reason and calls nothing', async () => {
    const user = userEvent.setup();
    loaded([makeListing()]);
    const { container } = renderPage();
    const dialog = getDialog(container);

    await user.click(screen.getByRole('button', { name: 'Suspend listing: Vintage Drill Press' }));
    await user.type(within(dialog).getByLabelText('Reason'), 'changed my mind');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel action' }));

    expect(dialog).not.toHaveAttribute('open');
    expect(suspendMutateAsync).not.toHaveBeenCalled();

    // Re-opening starts from a blank reason, so confirm is gated again.
    await user.click(screen.getByRole('button', { name: 'Cancel listing: Vintage Drill Press' }));
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: 'Cancel Listing' })).toBeDisabled();
  });

  it.each(['suspend', 'reactivate', 'cancel'] as const)(
    'locks the dialog while the %s mutation is pending',
    async (which) => {
      const user = userEvent.setup();
      pending[which] = true;
      loaded([makeListing()]);
      const { container } = renderPage();
      const dialog = getDialog(container);

      await user.click(
        screen.getByRole('button', { name: 'Suspend listing: Vintage Drill Press' }),
      );
      await user.type(within(dialog).getByLabelText('Reason'), 'reason');

      const confirm = within(dialog).getByRole('button', { name: 'Suspend Listing' });
      expect(confirm).toBeDisabled();
      expect(confirm).toHaveTextContent('Processing...');
      expect(within(dialog).getByRole('button', { name: 'Cancel action' })).toBeDisabled();
    },
  );
});

describe('AdminListingsPage — search, filter, pagination', () => {
  it('searches by the trimmed title only on submit', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();

    await user.type(screen.getByLabelText('Search listings'), '  drill  ');
    // Typing alone must not re-query with the draft text.
    expect(useAdminListingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ q: undefined }));

    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(useAdminListingsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'drill', page: 1 }),
    );

    await user.clear(screen.getByLabelText('Search listings'));
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(useAdminListingsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: undefined, page: 1 }),
    );
  });

  it('filters by status and clears the filter with "All Statuses"', () => {
    loaded([]);
    renderPage();
    const select = screen.getByRole('combobox');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All Statuses',
      'Active',
      'Sold',
      'Cancelled',
      'Expired',
      'Draft',
    ]);

    fireEvent.change(select, { target: { value: 'sold' } });
    expect(useAdminListingsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'sold', page: 1 }),
    );

    fireEvent.change(select, { target: { value: '__all__' } });
    expect(useAdminListingsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined, page: 1 }),
    );
  });

  it('derives the page count from total / page_size and pages forward', async () => {
    const user = userEvent.setup();
    loaded([makeListing()], { page: 1, page_size: 20, total: 45 });
    renderPage();

    expect(screen.getByText(/Showing page 1 of 3/)).toHaveTextContent('45 total');
    const next = screen.getByRole('button', { name: 'Go to next page' });
    expect(next).toBeEnabled();
    await user.click(next);

    expect(useAdminListingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    // Changing the filter sends the admin back to page 1.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'active' } });
    expect(useAdminListingsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'active', page: 1 }),
    );
  });

  it('disables Next on the last page', () => {
    loaded([makeListing()], { page: 2, page_size: 20, total: 40 });
    renderPage();

    expect(screen.getByText(/of 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled();
  });

  it('survives a zero page_size from the API without dividing by zero', () => {
    loaded([makeListing()], { page: 1, page_size: 0, total: 5 });
    renderPage();

    expect(screen.getByText(/Showing page 1 of 5/)).toBeInTheDocument();
  });

  it('hides the pager for a single page or when the API omits pagination', () => {
    loaded([makeListing()], { page: 1, page_size: 20, total: 0 });
    const { unmount } = renderPage();
    expect(screen.queryByRole('button', { name: 'Go to next page' })).not.toBeInTheDocument();
    unmount();

    useAdminListingsMock.mockReturnValue({
      data: { listings: [makeListing()] },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText('Vintage Drill Press')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to next page' })).not.toBeInTheDocument();
  });
});
