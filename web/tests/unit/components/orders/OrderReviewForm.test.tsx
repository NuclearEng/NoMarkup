import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OrderReviewForm } from '@/components/orders/OrderReviewForm';

vi.mock('@/hooks/useOrderReviews', () => ({
  useCreateListingOrderReview: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OrderReviewForm orderId="00000000-0000-0000-0000-000000000001" revieweeLabel="the seller" />
    </QueryClientProvider>,
  );
}

describe('OrderReviewForm (FE-14 goods MVP)', () => {
  it('requires overall rating before submit is enabled', () => {
    renderForm();
    const submit = screen.getByRole('button', { name: /submit review/i });
    expect(submit).toBeDisabled();
  });

  it('enables submit after selecting a star rating', async () => {
    const user = userEvent.setup();
    renderForm();
    // StarRatingInput exposes five role=radio star controls.
    const stars = screen.getAllByRole('radio', { name: /star/i });
    expect(stars.length).toBeGreaterThanOrEqual(4);
    await user.click(stars[3]!);
    const submit = screen.getByRole('button', { name: /submit review/i });
    expect(submit).not.toBeDisabled();
  });
});
