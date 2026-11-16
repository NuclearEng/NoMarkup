// Branch coverage for the admin Goods Disputes panel, complementing
// GoodsDisputesPanel.test.tsx: status filtering, retry, the release-to-seller
// and no-action payloads, partial-refund bounds, post-success reset, the
// in-flight lock on the confirm dialog, and the card's rendering fallbacks.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminGoodsDispute } from '@/hooks/useAdmin';

import { closest, getDialog, installDialogStub, nth } from '../../app/dashboard/_admin-branch-helpers';
import { withQueryClient } from '../../app/dashboard/_helpers';

vi.mock('@/components/ui/select', () => import('../../app/dashboard/_native-select-mock'));

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

const useAdminGoodsDisputesMock = vi.fn();
const resolveMutate = vi.fn();
const resolveState = { isPending: false };
const refetch = vi.fn();

vi.mock('@/hooks/useAdmin', () => ({
  useAdminGoodsDisputes: (...args: unknown[]) => useAdminGoodsDisputesMock(...args) as unknown,
  useResolveGoodsDispute: () => ({ mutate: resolveMutate, isPending: resolveState.isPending }),
}));

import { GoodsDisputesPanel } from '@/components/admin/GoodsDisputesPanel';

interface ResolveOptions {
  onSuccess: () => void;
  onError: (err: unknown) => void;
}

function makeDispute(overrides: Partial<AdminGoodsDispute> = {}): AdminGoodsDispute {
  return {
    id: 'd-1',
    listing_order_id: 'order-1',
    listing_id: 'listing-1',
    listing_title: 'Vintage Drill Press',
    opened_by: 'buyer-abcdef-123456',
    opened_by_email: 'buyer@example.com',
    dispute_type: 'item_not_as_described',
    description: 'Arrived with a cracked base.',
    status: 'open',
    amount_cents: 12000,
    created_at: '2026-06-01T12:00:00Z',
    ...overrides,
  };
}

function loaded(disputes: AdminGoodsDispute[]) {
  useAdminGoodsDisputesMock.mockReturnValue({
    data: { disputes },
    isLoading: false,
    isError: false,
    refetch,
  });
}

function panel() {
  return withQueryClient(createElement(GoodsDisputesPanel));
}

/** [0] is the panel's status filter; [1] is the (single) dispute's resolution. */
function statusFilter(): HTMLElement {
  return nth(screen.getAllByRole('combobox'), 0);
}

function chooseResolution(value: string) {
  fireEvent.change(nth(screen.getAllByRole('combobox'), 1), { target: { value } });
}

function lastResolveCall(): [unknown, ResolveOptions] {
  return nth(resolveMutate.mock.calls, resolveMutate.mock.calls.length - 1) as [
    unknown,
    ResolveOptions,
  ];
}

beforeAll(() => {
  installDialogStub();
});

beforeEach(() => {
  vi.clearAllMocks();
  useAdminGoodsDisputesMock.mockReset();
  resolveState.isPending = false;
});

describe('GoodsDisputesPanel — filter and retry', () => {
  it('loads the first 50 disputes of every status by default', () => {
    loaded([]);
    render(panel());

    expect(useAdminGoodsDisputesMock).toHaveBeenLastCalledWith({
      status: undefined,
      page: 1,
      page_size: 50,
    });
    expect(
      within(statusFilter())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All Statuses', 'Open', 'Investigating', 'Resolved', 'Closed']);
  });

  it('re-queries by status and clears the filter with "All Statuses"', () => {
    loaded([]);
    render(panel());

    fireEvent.change(statusFilter(), { target: { value: 'investigating' } });
    expect(useAdminGoodsDisputesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'investigating' }),
    );

    fireEvent.change(statusFilter(), { target: { value: '__all__' } });
    expect(useAdminGoodsDisputesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined }),
    );
  });

  it('retries the query from the error state', async () => {
    const user = userEvent.setup();
    useAdminGoodsDisputesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    render(panel());

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('prefers the error state over the loading skeleton', () => {
    useAdminGoodsDisputesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: true,
      refetch,
    });
    render(panel());

    expect(screen.getByText('Failed to load goods disputes')).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading goods disputes')).not.toBeInTheDocument();
  });
});

describe('GoodsDisputesPanel — dispute card fallbacks', () => {
  it('falls back to "Untitled listing" and a short buyer id', () => {
    loaded([makeDispute({ listing_title: '', opened_by_email: '' })]);
    render(panel());

    expect(screen.getByRole('heading', { name: 'Untitled listing' })).toBeInTheDocument();
    expect(screen.getByText('buyer-ab')).toBeInTheDocument();
  });

  it('humanises the status and type, and omits an empty description', () => {
    loaded([makeDispute({ status: 'awaiting_seller_reply', description: '' })]);
    render(panel());

    const card = closest(screen.getByText('Vintage Drill Press'), 'article');
    expect(within(card).getByText('Awaiting Seller Reply')).toBeInTheDocument();
    expect(within(card).getByText('Item Not As Described')).toBeInTheDocument();
    expect(within(card).getByText('$120.00')).toBeInTheDocument();
    expect(within(card).queryByText('Arrived with a cracked base.')).not.toBeInTheDocument();
    // A non-terminal status of any name can still be resolved.
    expect(within(card).getByRole('button', { name: 'Resolve dispute' })).toBeEnabled();
  });

  it.each([
    ['a positive refund', 4500, true],
    ['a zero refund', 0, false],
    ['no refund recorded', null, false],
  ])('shows the Refunded line only for %s', (_label, cents, shown) => {
    loaded([makeDispute({ status: 'resolved', refund_to_buyer_cents: cents })]);
    render(panel());

    expect(screen.queryByText('Refunded') !== null).toBe(shown);
    if (shown) expect(screen.getByText('$45.00')).toBeInTheDocument();
  });

  it('shows when a terminal dispute was resolved and hides the form', () => {
    loaded([makeDispute({ status: 'closed', resolved_at: '2026-06-09T12:00:00Z' })]);
    render(panel());

    expect(
      screen.getByText('This dispute has already been resolved on Jun 9, 2026.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve dispute' })).not.toBeInTheDocument();
  });

  it('omits the date when a terminal dispute has no resolved_at', () => {
    loaded([makeDispute({ status: 'resolved', resolved_at: null })]);
    render(panel());

    expect(screen.getByText('This dispute has already been resolved.')).toBeInTheDocument();
  });
});

describe('GoodsDisputesPanel — resolve form', () => {
  it('releases the full order amount to the seller', async () => {
    const user = userEvent.setup();
    loaded([makeDispute({ id: 'd-7' })]);
    const { container } = render(panel());
    const dialog = getDialog(container);

    chooseResolution('release_to_seller');
    expect(screen.queryByLabelText('Refund to buyer ($)')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Resolution notes'), '  buyer never replied  ');
    await user.click(screen.getByRole('button', { name: 'Resolve dispute' }));

    expect(dialog).toHaveAttribute('open');
    expect(
      within(dialog).getByText(
        'Apply “Release funds to seller” for $120.00. This moves money and cannot be undone from this screen.',
      ),
    ).toBeInTheDocument();
    expect(resolveMutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirm resolve' }));

    expect(resolveMutate).toHaveBeenCalledTimes(1);
    expect(lastResolveCall()[0]).toEqual({
      disputeId: 'd-7',
      resolution: 'release_to_seller',
      refund_to_buyer_cents: 0,
      transfer_to_seller_cents: 12000,
      notes: 'buyer never replied',
    });
  });

  it('resolves with no action and moves no money', async () => {
    const user = userEvent.setup();
    loaded([makeDispute()]);
    const { container } = render(panel());
    const dialog = getDialog(container);

    chooseResolution('no_action');
    await user.click(screen.getByRole('button', { name: 'Resolve dispute' }));

    expect(
      within(dialog).getByText(/Resolve this goods dispute with “No action”\?/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm resolve' }));

    expect(lastResolveCall()[0]).toEqual({
      disputeId: 'd-1',
      resolution: 'no_action',
      refund_to_buyer_cents: 0,
      transfer_to_seller_cents: 0,
      notes: '',
    });
  });

  it('rejects a $0 partial refund and clears the error on edit', async () => {
    const user = userEvent.setup();
    loaded([makeDispute()]);
    const { container } = render(panel());

    chooseResolution('refund_partial');
    const refund = screen.getByLabelText('Refund to buyer ($)');
    await user.type(refund, '0');
    await user.click(screen.getByRole('button', { name: 'Resolve dispute' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a refund amount greater than $0 for a partial refund.');
    expect(refund).toHaveAccessibleDescription(alert.textContent);
    expect(getDialog(container)).not.toHaveAttribute('open');

    await user.type(refund, '1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(refund).not.toHaveAttribute('aria-describedby');
  });

  it('rejects a partial refund larger than the order, and clears the error on a new resolution', async () => {
    const user = userEvent.setup();
    loaded([makeDispute({ amount_cents: 12000 })]);
    const { container } = render(panel());

    chooseResolution('refund_partial');
    await user.type(screen.getByLabelText('Refund to buyer ($)'), '120.01');
    await user.click(screen.getByRole('button', { name: 'Resolve dispute' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Refund cannot exceed the order amount.');
    expect(getDialog(container)).not.toHaveAttribute('open');
    expect(resolveMutate).not.toHaveBeenCalled();

    chooseResolution('refund_full');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('accepts a partial refund equal to the order amount and shows it in the confirmation', async () => {
    const user = userEvent.setup();
    loaded([makeDispute({ amount_cents: 12000 })]);
    const { container } = render(panel());
    const dialog = getDialog(container);

    chooseResolution('refund_partial');
    await user.type(screen.getByLabelText('Refund to buyer ($)'), '120');
    await user.click(screen.getByRole('button', { name: 'Resolve dispute' }));

    expect(
      within(dialog).getByText(/Apply “Partial refund” of \$120\.00 on order \$120\.00\./),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm resolve' }));

    expect(lastResolveCall()[0]).toEqual(
      expect.objectContaining({
        resolution: 'refund_partial',
        refund_to_buyer_cents: 12000,
        transfer_to_seller_cents: 0,
      }),
    );
  });

  it('on success: toasts, closes the dialog and clears the form', async () => {
    const user = userEvent.setup();
    loaded([makeDispute()]);
    const { container } = render(panel());
    const dialog = getDialog(container);

    chooseResolution('refund_partial');
    await user.type(screen.getByLabelText('Refund to buyer ($)'), '25.50');
    await user.type(screen.getByLabelText('Resolution notes'), 'split the difference');
    await user.click(screen.getByRole('button', { name: 'Resolve dispute' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm resolve' }));
    expect(dialog).toHaveAttribute('open');

    act(() => {
      lastResolveCall()[1].onSuccess();
    });

    expect(toastSuccess).toHaveBeenCalledWith('Dispute resolved');
    expect(dialog).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('');
    expect(screen.getByLabelText('Refund to buyer ($)')).toHaveValue(null);
    expect(within(dialog).getByText(/of \$0\.00 on order/)).toBeInTheDocument();
  });

  it('on failure: keeps the dialog open and falls back to a generic toast', async () => {
    const user = userEvent.setup();
    loaded([makeDispute()]);
    const { container } = render(panel());
    const dialog = getDialog(container);

    await user.click(screen.getByRole('button', { name: 'Resolve dispute' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm resolve' }));

    act(() => {
      lastResolveCall()[1].onError('opaque failure');
    });

    expect(toastError).toHaveBeenCalledWith('Could not resolve dispute');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
  });

  it('cancelling the confirmation resolves nothing', async () => {
    const user = userEvent.setup();
    loaded([makeDispute()]);
    const { container } = render(panel());
    const dialog = getDialog(container);

    await user.click(screen.getByRole('button', { name: 'Resolve dispute' }));
    expect(dialog).toHaveAttribute('open');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel action' }));

    expect(dialog).not.toHaveAttribute('open');
    expect(resolveMutate).not.toHaveBeenCalled();
  });

  it('locks the form and the confirmation while a resolution is in flight', async () => {
    const user = userEvent.setup();
    loaded([makeDispute()]);
    const { container, rerender } = render(panel());
    const dialog = getDialog(container);

    await user.click(screen.getByRole('button', { name: 'Resolve dispute' }));
    expect(dialog).toHaveAttribute('open');

    resolveState.isPending = true;
    rerender(panel());

    expect(screen.getByRole('button', { name: 'Resolving...' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Confirm resolve' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel action' })).toBeDisabled();

    // Escape on a native <dialog> fires `close`; it must be ignored mid-flight.
    fireEvent(dialog, new Event('close'));
    expect(dialog).toHaveAttribute('open');

    resolveState.isPending = false;
    rerender(panel());
    fireEvent(dialog, new Event('close'));
    expect(dialog).not.toHaveAttribute('open');
  });
});
