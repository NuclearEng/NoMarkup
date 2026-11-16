import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// MOCKED: useCreateListingOrderReview (the mutation). PROVEN: the payload the
// form submits, the review-window countdown copy, and the pending state.

interface ReviewVariables {
  orderId: string;
  input: { overall_rating: number; comment: string };
}

const { mutate, state } = vi.hoisted(() => ({
  mutate: vi.fn<(variables: ReviewVariables, options?: { onSuccess?: () => void }) => void>(),
  state: { isPending: false },
}));

vi.mock('@/hooks/useOrderReviews', () => ({
  useCreateListingOrderReview: () => ({ mutate, isPending: state.isPending }),
}));

import { OrderReviewForm } from '@/components/orders/OrderReviewForm';

const NOW = new Date('2026-03-10T12:00:00Z');

function star(index: number): HTMLElement {
  const stars = screen.getAllByRole('radio', { name: /star/i });
  const el = stars[index];
  if (!el) throw new Error(`expected star radio at index ${String(index)}`);
  return el;
}

describe('OrderReviewForm — submit payload and review window', () => {
  beforeEach(() => {
    mutate.mockReset();
    state.isPending = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits the chosen rating and a trimmed comment for this order', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<OrderReviewForm orderId="order-7" revieweeLabel="the seller" onSuccess={onSuccess} />);

    expect(screen.getByText(/Rate your experience with the seller/)).toBeInTheDocument();
    await user.click(star(4));
    await user.type(screen.getByLabelText('Review comment'), '  Smooth pickup  ');
    await user.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
    expect(mutate).toHaveBeenCalledWith(
      { orderId: 'order-7', input: { overall_rating: 5, comment: 'Smooth pickup' } },
      { onSuccess },
    );
  });

  it('submits an empty comment when the buyer only rates', async () => {
    const user = userEvent.setup();
    render(<OrderReviewForm orderId="order-7" revieweeLabel="the buyer" />);
    await user.click(star(0));
    await user.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      orderId: 'order-7',
      input: { overall_rating: 1, comment: '' },
    });
  });

  it('does not submit while no rating is selected', async () => {
    const user = userEvent.setup();
    render(<OrderReviewForm orderId="order-7" revieweeLabel="the seller" />);
    await user.type(screen.getByLabelText('Review comment'), 'No stars yet');
    await user.click(screen.getByRole('button', { name: /submit review/i }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('disables the button and says Submitting while the review is in flight', () => {
    state.isPending = true;
    render(<OrderReviewForm orderId="order-7" revieweeLabel="the seller" />);
    const button = screen.getByRole('button', { name: /submitting/i });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: /submit review/i })).toBeNull();
  });

  it('shows no countdown when the review window is unknown', () => {
    render(<OrderReviewForm orderId="order-7" revieweeLabel="the seller" />);
    expect(screen.queryByText(/remaining to submit/i)).toBeNull();
  });

  it('counts whole days left, rounding a partial day up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <OrderReviewForm
        orderId="order-7"
        revieweeLabel="the seller"
        reviewWindowClosesAt="2026-03-13T00:00:00Z"
      />,
    );
    // 2.5 days away → 3 days.
    expect(screen.getByText('3 days remaining to submit')).toBeInTheDocument();
  });

  it('uses the singular for the final day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <OrderReviewForm
        orderId="order-7"
        revieweeLabel="the seller"
        reviewWindowClosesAt="2026-03-10T18:00:00Z"
      />,
    );
    expect(screen.getByText('1 day remaining to submit')).toBeInTheDocument();
  });

  it('hides the countdown once the window has closed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <OrderReviewForm
        orderId="order-7"
        revieweeLabel="the seller"
        reviewWindowClosesAt="2026-03-01T00:00:00Z"
      />,
    );
    expect(screen.queryByText(/remaining to submit/i)).toBeNull();
  });
});
