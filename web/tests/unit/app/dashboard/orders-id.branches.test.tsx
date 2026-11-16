// Order detail page — branches the base spec leaves out: the seller's half of
// the handshake, the dispute dialog (validation + payload), the no-show
// confirm round trip, post-completion reviews and the review-eligibility
// states, and the refetch wiring of the unpaid-order prompt.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment, type ChangeEvent, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LISTING_ORDER_STATUS } from '@/types';
import type {
  ListingOrder,
  ListingOrderReview,
  ListingOrderReviewEligibility,
} from '@/types';

interface MutationStub<TArgs extends unknown[]> {
  mutate: ReturnType<typeof vi.fn<(...args: TArgs) => void>>;
  isPending: boolean;
}

const h = vi.hoisted(() => ({
  userId: 'me' as string | undefined,
  order: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn<() => Promise<void>>(),
  },
  eligibility: { data: undefined as unknown, isLoading: false, enabled: false },
  reviews: { data: undefined as unknown, enabled: false },
  promptProps: null as { onPaid?: () => void; onCanceled?: () => void } | null,
}));

const confirmPickup: MutationStub<[string]> = { mutate: vi.fn(), isPending: false };
const sellerConfirm: MutationStub<[string]> = { mutate: vi.fn(), isPending: false };
const disputeOrder: MutationStub<
  [{ orderId: string; reason: string; description: string }]
> = { mutate: vi.fn(), isPending: false };
const reportNoShow: MutationStub<[string, { onSuccess?: () => void }?]> = {
  mutate: vi.fn(),
  isPending: false,
};

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'o-1' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useListings', () => ({
  useListingOrder: () => h.order,
  useConfirmPickup: () => confirmPickup,
  useSellerConfirm: () => sellerConfirm,
  useDisputeOrder: () => disputeOrder,
  useReportOrderNoShow: () => reportNoShow,
}));

vi.mock('@/hooks/useOrderReviews', () => ({
  useListingOrderReviewEligibility: (_orderId: string, enabled: boolean) => {
    h.eligibility.enabled = enabled;
    return { data: h.eligibility.data, isLoading: h.eligibility.isLoading };
  },
  useListingOrderReviews: (_orderId: string, enabled: boolean) => {
    h.reviews.enabled = enabled;
    return { data: h.reviews.data };
  },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: h.userId === undefined ? null : { id: h.userId } }),
}));

vi.mock('@/components/orders/OrderPaymentPrompt', () => ({
  OrderPaymentPrompt: (props: { onPaid?: () => void; onCanceled?: () => void }) => {
    h.promptProps = props;
    return createElement('div', { 'data-testid': 'order-payment-prompt' });
  },
}));

vi.mock('@/components/orders/OrderReviewForm', () => ({
  OrderReviewForm: (props: {
    orderId: string;
    revieweeLabel: string;
    reviewWindowClosesAt?: string;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'order-review-form' },
      `${props.orderId}|${props.revieweeLabel}|${props.reviewWindowClosesAt ?? 'none'}`,
    ),
}));

// Radix Select needs pointer capture, which jsdom lacks. Swap in a native
// <select> whose options are the page's own SelectItems.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (val: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      'select',
      {
        'aria-label': 'Dispute reason',
        value,
        onChange: (e: ChangeEvent<HTMLSelectElement>) => {
          onValueChange(e.target.value);
        },
      },
      createElement('option', { value: '' }, 'Select a reason'),
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement('option', { value }, children),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

import OrderDetailPage from '@/app/(dashboard)/orders/[id]/page';

const HOUR = 60 * 60 * 1000;

function makeOrder(over: Partial<ListingOrder> = {}): ListingOrder {
  return {
    id: 'o-1',
    listing_id: 'l-1',
    listing_title: 'Vintage bike',
    listing_photo_url: null,
    buyer_id: 'me',
    seller_id: 's-1',
    seller_display_name: 'Jane Seller',
    pickup_address: '123 Main St',
    pickup_zip: '94110',
    pickup_city: 'San Francisco',
    pickup_state: 'CA',
    amount_cents: 12000,
    platform_fee_cents: 1200,
    status: LISTING_ORDER_STATUS.PAID,
    channel_id: 'ch-1',
    paid_at: '2026-06-01T00:00:00Z',
    picked_up_at: null,
    seller_confirmed_at: null,
    completed_at: null,
    dispute_window_ends_at: null,
    created_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

function makeReview(over: Partial<ListingOrderReview>): ListingOrderReview {
  return {
    id: 'rev-1',
    order_id: 'o-1',
    listing_id: 'l-1',
    reviewer_id: 'me',
    reviewee_id: 's-1',
    reviewer_role: 'buyer',
    overall_rating: 5,
    comment: 'Great handoff',
    status: 'published',
    review_window_ends_at: '2026-07-01T00:00:00Z',
    created_at: '2026-06-02T00:00:00Z',
    ...over,
  };
}

function show(order: ListingOrder) {
  h.order.data = order;
  return render(<OrderDetailPage />);
}

function setEligibility(value: ListingOrderReviewEligibility | undefined) {
  h.eligibility.data = value;
}

function button(name: string | RegExp): HTMLButtonElement {
  const el = screen.getByRole('button', { name });
  if (!(el instanceof HTMLButtonElement)) throw new Error('expected a button');
  return el;
}

beforeEach(() => {
  h.userId = 'me';
  h.order.data = undefined;
  h.order.isLoading = false;
  h.order.isError = false;
  h.order.refetch = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  h.eligibility.data = undefined;
  h.eligibility.isLoading = false;
  h.eligibility.enabled = false;
  h.reviews.data = undefined;
  h.reviews.enabled = false;
  h.promptProps = null;
  for (const m of [confirmPickup, sellerConfirm, disputeOrder, reportNoShow]) {
    m.mutate.mockReset();
    m.isPending = false;
  }
});

describe('OrderDetailPage — load failures', () => {
  it('retries the order fetch from the error state', async () => {
    h.order.isError = true;
    const user = userEvent.setup();
    render(<OrderDetailPage />);
    await user.click(button('Retry'));
    expect(h.order.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows Order not found when the fetch succeeded with no order', () => {
    render(<OrderDetailPage />);
    expect(screen.getByText('Order not found')).toBeInTheDocument();
    expect(screen.queryByText('Actions')).toBeNull();
  });
});

describe('OrderDetailPage — handshake by role', () => {
  it('the seller confirms through seller-confirm, never the buyer endpoint', async () => {
    h.userId = 's-1';
    const user = userEvent.setup();
    show(makeOrder());

    await user.click(button('Confirm handoff'));
    expect(sellerConfirm.mutate).toHaveBeenCalledWith('o-1');
    expect(confirmPickup.mutate).not.toHaveBeenCalled();
  });

  it('the seller can still confirm after the buyer has picked up', () => {
    h.userId = 's-1';
    show(
      makeOrder({
        status: LISTING_ORDER_STATUS.PICKED_UP,
        picked_up_at: '2026-06-02T00:00:00Z',
      }),
    );
    expect(button('Confirm handoff')).toBeEnabled();
  });

  it('the seller who already confirmed waits for the buyer', () => {
    h.userId = 's-1';
    show(makeOrder({ seller_confirmed_at: '2026-06-02T00:00:00Z' }));
    expect(button('Waiting for the other party')).toBeDisabled();
  });

  it('disables confirm while either confirmation is in flight', () => {
    sellerConfirm.isPending = true;
    show(makeOrder());
    expect(button(/Confirm pickup/)).toBeDisabled();
  });

  it('a completed order shows Pickup confirmed, disabled, with a completed badge', () => {
    show(
      makeOrder({
        status: LISTING_ORDER_STATUS.COMPLETED,
        picked_up_at: '2026-06-02T00:00:00Z',
        seller_confirmed_at: '2026-06-02T00:00:00Z',
      }),
    );
    expect(button('Pickup confirmed')).toBeDisabled();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('prints a multi-word status without the underscore', () => {
    show(makeOrder({ status: LISTING_ORDER_STATUS.PICKED_UP }));
    expect(screen.getByText('picked up')).toBeInTheDocument();
  });

  it('a disputed order cannot be confirmed, disputed again, or reported', () => {
    show(makeOrder({ status: LISTING_ORDER_STATUS.DISPUTED }));
    expect(screen.getByText('disputed').className).toMatch(/red/);
    expect(button(/Confirm pickup/)).toBeDisabled();
    expect(button('Open dispute')).toBeDisabled();
    expect(button('Report no-show')).toBeDisabled();
  });

  it('someone who is neither buyer nor seller cannot report a no-show', () => {
    h.userId = 'stranger';
    show(makeOrder());
    expect(button('Report no-show')).toBeDisabled();
  });

  it('says chat is unavailable when the order has no channel', () => {
    show(makeOrder({ channel_id: null }));
    expect(screen.getByText(/Chat is unavailable for this order/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open chat/ })).toBeNull();
  });
});

describe('OrderDetailPage — dispute window', () => {
  it('tells the buyer the window has closed and blocks a new dispute', () => {
    show(
      makeOrder({
        status: LISTING_ORDER_STATUS.PICKED_UP,
        dispute_window_ends_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      }),
    );
    expect(button('Open dispute')).toBeDisabled();
    expect(screen.getByText(/Dispute window closes/)).toBeInTheDocument();
  });

  it('does not print the window note while a dispute can still be opened', () => {
    show(
      makeOrder({
        status: LISTING_ORDER_STATUS.PICKED_UP,
        dispute_window_ends_at: new Date(Date.now() + 2 * HOUR).toISOString(),
      }),
    );
    expect(button('Open dispute')).toBeEnabled();
    expect(screen.queryByText(/Dispute window closes/)).toBeNull();
  });

  it('disables Open dispute while a dispute is being filed', () => {
    disputeOrder.isPending = true;
    show(
      makeOrder({
        status: LISTING_ORDER_STATUS.PICKED_UP,
        dispute_window_ends_at: new Date(Date.now() + 2 * HOUR).toISOString(),
      }),
    );
    expect(button('Open dispute')).toBeDisabled();
  });
});

describe('OrderDetailPage — dispute dialog', () => {
  function disputable(): ListingOrder {
    return makeOrder({
      status: LISTING_ORDER_STATUS.PICKED_UP,
      dispute_window_ends_at: new Date(Date.now() + 2 * HOUR).toISOString(),
    });
  }

  it('requires a reason and at least 20 characters before it can be submitted', async () => {
    const user = userEvent.setup();
    show(disputable());
    await user.click(button('Open dispute'));

    const dialog = screen.getByRole('dialog', { name: 'Open a dispute' });
    const submit = within(dialog).getByRole('button', { name: 'Submit dispute' });
    const description = within(dialog).getByLabelText('Dispute description');
    expect(submit).toBeDisabled();
    expect(within(dialog).queryByRole('alert')).toBeNull();

    await user.type(description, 'Too short');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Please add at least 20 characters so our team can review.',
    );
    expect(description).toHaveAttribute('aria-invalid', 'true');
    expect(description).toHaveAttribute('aria-describedby', 'dispute-description-error');
    expect(submit).toBeDisabled();

    await user.type(description, ' — the frame is cracked.');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(description).toHaveAttribute('aria-invalid', 'false');
    // Long enough, but still no reason.
    expect(submit).toBeDisabled();

    await user.selectOptions(within(dialog).getByLabelText('Dispute reason'), 'item_damaged');
    expect(submit).toBeEnabled();
  });

  it('does not count padding whitespace toward the 20 characters', async () => {
    const user = userEvent.setup();
    show(disputable());
    await user.click(button('Open dispute'));
    const dialog = screen.getByRole('dialog', { name: 'Open a dispute' });

    await user.selectOptions(within(dialog).getByLabelText('Dispute reason'), 'other');
    await user.type(
      within(dialog).getByLabelText('Dispute description'),
      '   short                    ',
    );
    expect(within(dialog).getByRole('button', { name: 'Submit dispute' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();
  });

  it('offers exactly the reasons the gateway accepts', async () => {
    const user = userEvent.setup();
    show(disputable());
    await user.click(button('Open dispute'));
    const options = within(screen.getByLabelText('Dispute reason')).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('value'))).toEqual([
      '',
      'item_not_as_described',
      'item_damaged',
      'no_show',
      'item_not_received',
      'other',
    ]);
  });

  it('files the dispute with the reason and trimmed description, then closes and resets', async () => {
    const user = userEvent.setup();
    show(disputable());
    await user.click(button('Open dispute'));
    let dialog = screen.getByRole('dialog', { name: 'Open a dispute' });

    await user.selectOptions(
      within(dialog).getByLabelText('Dispute reason'),
      'item_not_as_described',
    );
    await user.type(
      within(dialog).getByLabelText('Dispute description'),
      '  The bike is a different model than listed.  ',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Submit dispute' }));

    expect(disputeOrder.mutate).toHaveBeenCalledTimes(1);
    expect(disputeOrder.mutate).toHaveBeenCalledWith({
      orderId: 'o-1',
      reason: 'item_not_as_described',
      description: 'The bike is a different model than listed.',
    });
    expect(screen.queryByRole('dialog', { name: 'Open a dispute' })).toBeNull();

    // Reopening starts from a blank form.
    await user.click(button('Open dispute'));
    dialog = screen.getByRole('dialog', { name: 'Open a dispute' });
    expect(within(dialog).getByLabelText('Dispute description')).toHaveValue('');
    expect(within(dialog).getByLabelText('Dispute reason')).toHaveValue('');
  });

  it('Cancel closes the dialog without filing anything', async () => {
    const user = userEvent.setup();
    show(disputable());
    await user.click(button('Open dispute'));
    const dialog = screen.getByRole('dialog', { name: 'Open a dispute' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Open a dispute' })).toBeNull();
    expect(disputeOrder.mutate).not.toHaveBeenCalled();
  });
});

describe('OrderDetailPage — report no-show', () => {
  function noShowDialog(): HTMLElement {
    const el = document.querySelector('dialog');
    if (!el) throw new Error('expected the confirm dialog');
    return el;
  }

  it('reports only after confirmation and closes when the report succeeds', async () => {
    const user = userEvent.setup();
    show(makeOrder());
    expect(noShowDialog()).not.toHaveAttribute('open');

    await user.click(button('Report no-show'));
    expect(noShowDialog()).toHaveAttribute('open');
    expect(reportNoShow.mutate).not.toHaveBeenCalled();

    await user.click(within(noShowDialog()).getByRole('button', { name: 'Report no-show' }));
    expect(reportNoShow.mutate).toHaveBeenCalledTimes(1);
    expect(reportNoShow.mutate.mock.calls[0]?.[0]).toBe('o-1');
    // Still open until the server accepts the report.
    expect(noShowDialog()).toHaveAttribute('open');

    reportNoShow.mutate.mock.calls[0]?.[1]?.onSuccess?.();
    await vi.waitFor(() => {
      expect(noShowDialog()).not.toHaveAttribute('open');
    });
  });

  it('backing out of the confirmation reports nothing', async () => {
    const user = userEvent.setup();
    show(makeOrder());
    await user.click(button('Report no-show'));
    await user.click(within(noShowDialog()).getByRole('button', { name: 'Cancel action' }));

    expect(noShowDialog()).not.toHaveAttribute('open');
    expect(reportNoShow.mutate).not.toHaveBeenCalled();
  });

  it('the seller can report a no-show too', () => {
    h.userId = 's-1';
    show(makeOrder());
    expect(button('Report no-show')).toBeEnabled();
  });
});

describe('OrderDetailPage — unpaid order prompt', () => {
  it('refetches the order after payment and after cancellation', () => {
    show(makeOrder({ status: LISTING_ORDER_STATUS.PENDING }));
    expect(screen.getByTestId('order-payment-prompt')).toBeInTheDocument();

    h.promptProps?.onPaid?.();
    expect(h.order.refetch).toHaveBeenCalledTimes(1);
    h.promptProps?.onCanceled?.();
    expect(h.order.refetch).toHaveBeenCalledTimes(2);
  });

  it('shows the loading state, not the payment prompt, while the viewer’s identity has not loaded', () => {
    h.userId = undefined;
    show(makeOrder({ status: LISTING_ORDER_STATUS.PENDING }));
    expect(screen.getByRole('status', { name: 'Loading order' })).toBeInTheDocument();
    expect(screen.queryByTestId('order-payment-prompt')).toBeNull();
    expect(screen.queryByText('Awaiting buyer payment')).toBeNull();
  });
});

describe('OrderDetailPage — reviews after completion', () => {
  const completed = () => makeOrder({ status: LISTING_ORDER_STATUS.COMPLETED });

  it('does not ask for review data until the order is completed', () => {
    show(makeOrder());
    expect(h.eligibility.enabled).toBe(false);
    expect(h.reviews.enabled).toBe(false);
    expect(screen.queryByTestId('order-review-form')).toBeNull();
    expect(screen.queryByText('Reviews on this order')).toBeNull();
  });

  it('lists both reviews, marks the viewer’s own, and handles a missing comment', () => {
    h.reviews.data = [
      makeReview({ id: 'rev-buyer', reviewer_id: 'me', reviewer_role: 'buyer' }),
      makeReview({
        id: 'rev-seller',
        reviewer_id: 's-1',
        reviewer_role: 'seller',
        overall_rating: 3,
        comment: '',
      }),
    ];
    show(completed());

    expect(h.reviews.enabled).toBe(true);
    expect(screen.getByText('Reviews on this order')).toBeInTheDocument();
    expect(screen.getByText('Buyer review (you)')).toBeInTheDocument();
    expect(screen.getByText('Great handoff')).toBeInTheDocument();
    expect(screen.getByText('Seller review')).toBeInTheDocument();
    expect(screen.getByText('No written comment.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rating: 5 out of 5 stars' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rating: 3 out of 5 stars' })).toBeInTheDocument();
  });

  it('omits the reviews card when nobody has reviewed yet', () => {
    h.reviews.data = [];
    show(completed());
    expect(screen.queryByText('Reviews on this order')).toBeNull();
  });

  it('asks the buyer to review the seller by name, passing the window', () => {
    setEligibility({
      eligible: true,
      already_reviewed: false,
      review_window_closes_at: '2026-07-01T00:00:00Z',
    });
    show(completed());
    expect(screen.getByTestId('order-review-form')).toHaveTextContent(
      'o-1|Jane Seller|2026-07-01T00:00:00Z',
    );
  });

  it('falls back to "the seller" when the seller has no display name', () => {
    setEligibility({ eligible: true, already_reviewed: false });
    show(makeOrder({ status: LISTING_ORDER_STATUS.COMPLETED, seller_display_name: '' }));
    expect(screen.getByTestId('order-review-form')).toHaveTextContent('o-1|the seller|none');
  });

  it('asks the seller to review the buyer', () => {
    h.userId = 's-1';
    setEligibility({ eligible: true, already_reviewed: false });
    show(completed());
    expect(screen.getByTestId('order-review-form')).toHaveTextContent('o-1|the buyer|none');
  });

  it('thanks a party who has already reviewed instead of showing the form', () => {
    setEligibility({ eligible: false, already_reviewed: true });
    show(completed());
    expect(screen.getByText(/You already left a review for this order/)).toBeInTheDocument();
    expect(screen.queryByTestId('order-review-form')).toBeNull();
  });

  it('explains a closed review window', () => {
    setEligibility({ eligible: false, already_reviewed: false });
    show(completed());
    expect(
      screen.getByText('The review window for this order is closed or not open yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('order-review-form')).toBeNull();
  });

  it('shows neither form nor notice while eligibility is loading or unknown', () => {
    h.eligibility.isLoading = true;
    const { unmount } = show(completed());
    expect(screen.queryByTestId('order-review-form')).toBeNull();
    expect(screen.queryByText(/review window/i)).toBeNull();
    unmount();

    h.eligibility.isLoading = false;
    show(completed());
    expect(screen.queryByTestId('order-review-form')).toBeNull();
    expect(screen.queryByText(/review window/i)).toBeNull();
    expect(screen.queryByText(/already left a review/i)).toBeNull();
  });
});
