import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BidPlacementPanel } from '@/components/bids/BidPlacementPanel';

describe('BidPlacementPanel', () => {
  it('renders the place bid heading', () => {
    render(<BidPlacementPanel currentLowest={20000} startingPrice={30000} />);
    expect(screen.getByText(/place your bid/i)).toBeDefined();
  });

  it('seeds the bid input with a value below the current lowest', () => {
    render(<BidPlacementPanel currentLowest={20000} startingPrice={30000} />);
    const input = screen.getByLabelText('Bid amount in dollars') as HTMLInputElement;
    // Suggested = 95% of 20000 cents = 19000 cents = $190.00
    expect(input.value).toBe('190.00');
  });

  it('decreases the bid by $5 when the minus button is clicked', async () => {
    const user = userEvent.setup();
    render(<BidPlacementPanel currentLowest={20000} startingPrice={30000} />);
    const input = screen.getByLabelText('Bid amount in dollars') as HTMLInputElement;
    const minus = screen.getByLabelText('Decrease bid by $5');
    await user.click(minus);
    expect(input.value).toBe('185.00');
  });

  it('increases the bid by $5 when the plus button is clicked', async () => {
    const user = userEvent.setup();
    render(<BidPlacementPanel currentLowest={20000} startingPrice={30000} />);
    const input = screen.getByLabelText('Bid amount in dollars') as HTMLInputElement;
    const plus = screen.getByLabelText('Increase bid by $5');
    await user.click(plus);
    expect(input.value).toBe('195.00');
  });

  it('snaps the bid to a quick-amount pill', async () => {
    const user = userEvent.setup();
    render(<BidPlacementPanel currentLowest={20000} startingPrice={30000} />);
    const input = screen.getByLabelText('Bid amount in dollars') as HTMLInputElement;
    await user.click(screen.getByRole('button', { name: '-10%' }));
    // 90% of 20000 = 18000 = $180.00
    expect(input.value).toBe('180.00');
  });

  it('calls onPlaceBid with the cents amount when submit is clicked', async () => {
    const onPlaceBid = vi.fn();
    const user = userEvent.setup();
    render(
      <BidPlacementPanel
        currentLowest={20000}
        startingPrice={30000}
        onPlaceBid={onPlaceBid}
      />,
    );
    const submit = screen.getByRole('button', { name: /place bid/i });
    await user.click(submit);
    expect(onPlaceBid).toHaveBeenCalledWith(19000);
  });

  it('shows a submitting state when isSubmitting is true', () => {
    render(
      <BidPlacementPanel
        currentLowest={20000}
        startingPrice={30000}
        isSubmitting
      />,
    );
    expect(screen.getByText(/placing bid/i)).toBeDefined();
  });

  it('shows a savings percent based on starting price', () => {
    render(<BidPlacementPanel currentLowest={20000} startingPrice={30000} />);
    // Suggested 19000 vs 30000 starting = 37% savings (rounded)
    expect(screen.getByText(/37% below starting price/i)).toBeDefined();
  });
});
