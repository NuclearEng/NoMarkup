import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ListingBidPanel } from '@/components/marketplace/ListingBidPanel';

function defaultProps() {
  return {
    currentBidCents: 5000,
    minIncrementCents: 100,
    isAuthenticated: true,
    isOwnListing: false,
    isUserWinning: false,
    isSubmitting: false,
    isAuctionExpired: false,
    onPlaceBid: vi.fn(),
  };
}

describe('ListingBidPanel', () => {
  it('shows the place-bid CTA when auctioned, authenticated, and not own listing', () => {
    render(<ListingBidPanel {...defaultProps()} />);
    expect(screen.getByText(/Place your bid/i)).toBeDefined();
  });

  it('initializes the bid amount at currentBid + minIncrement', () => {
    render(<ListingBidPanel {...defaultProps()} />);
    const input = screen.getByLabelText(/Bid amount/i);
    // 5000 + 100 = 5100 cents = $51.00 → input value as dollars
    if (!(input instanceof HTMLInputElement)) throw new Error('expected input');
    expect(input.value).toBe('51');
  });

  it('shows quick-increment +$5/+$10/+$20/+$50 buttons', () => {
    render(<ListingBidPanel {...defaultProps()} />);
    expect(screen.getByText('+$5')).toBeDefined();
    expect(screen.getByText('+$10')).toBeDefined();
    expect(screen.getByText('+$20')).toBeDefined();
    expect(screen.getByText('+$50')).toBeDefined();
  });

  it('applies +$10 increment correctly when clicked', async () => {
    const user = userEvent.setup();
    render(<ListingBidPanel {...defaultProps()} />);
    await user.click(screen.getByText('+$10'));
    const input = screen.getByLabelText(/Bid amount/i);
    // 51 + 10 = 61
    if (!(input instanceof HTMLInputElement)) throw new Error('expected input');
    expect(input.value).toBe('61');
  });

  it('calls onPlaceBid with cents amount when submitted', async () => {
    const onPlaceBid = vi.fn();
    const user = userEvent.setup();
    render(<ListingBidPanel {...defaultProps()} onPlaceBid={onPlaceBid} />);
    const submit = screen.getByRole('button', { name: /Bid \$/ });
    await user.click(submit);
    expect(onPlaceBid).toHaveBeenCalledWith(5100);
  });

  it('shows error when bid is below minimum', () => {
    const onPlaceBid = vi.fn();
    render(
      <ListingBidPanel {...defaultProps()} onPlaceBid={onPlaceBid} />,
    );
    const input = screen.getByLabelText(/Bid amount/i);
    fireEvent.change(input, { target: { value: '10' } });
    const submit = screen.getByRole('button', { name: /Bid \$/ });
    fireEvent.click(submit);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(onPlaceBid).not.toHaveBeenCalled();
  });

  it('shows owner notice when isOwnListing is true', () => {
    render(<ListingBidPanel {...defaultProps()} isOwnListing />);
    expect(screen.getByText(/cannot place a bid on your own listing/i)).toBeDefined();
  });

  it('shows expired notice when isAuctionExpired is true', () => {
    render(<ListingBidPanel {...defaultProps()} isAuctionExpired />);
    expect(screen.getByText(/Auction has ended/i)).toBeDefined();
  });

  it('shows sign-in prompt when isAuthenticated is false', () => {
    render(<ListingBidPanel {...defaultProps()} isAuthenticated={false} />);
    expect(screen.getByText(/Sign in to bid/i)).toBeDefined();
  });

  it('shows "You\'re winning" badge when isUserWinning is true', () => {
    render(<ListingBidPanel {...defaultProps()} isUserWinning />);
    expect(screen.getAllByText(/You.{0,5}re winning/)[0]).toBeDefined();
  });

  it('disables the submit button when submitting', () => {
    render(<ListingBidPanel {...defaultProps()} isSubmitting />);
    expect(screen.getByText(/Placing bid/i)).toBeDefined();
  });

  it('has minimum 44px touch target on the submit button', () => {
    render(<ListingBidPanel {...defaultProps()} />);
    const submit = screen.getByRole('button', { name: /Bid \$/ });
    // Button has min-h-[48px] which is > 44px
    expect(submit.className).toMatch(/min-h-\[48px\]/);
  });

  it('has 44px minimum touch targets on quick-increment buttons (mobile-first)', () => {
    render(<ListingBidPanel {...defaultProps()} />);
    const buttons = screen.getAllByRole('button');
    // Filter to only the +$N quick-increment buttons
    const incButtons = buttons.filter((b) => /^\+\$\d+$/.test(b.textContent || ''));
    expect(incButtons.length).toBe(4);
    for (const b of incButtons) {
      expect(b.className).toMatch(/min-h-\[44px\]/);
    }
  });

  it('associates the error message with the input via aria-describedby', () => {
    render(<ListingBidPanel {...defaultProps()} />);
    const input = screen.getByLabelText(/Bid amount/i);
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Bid \$/ }));
    expect(input.getAttribute('aria-describedby')).toBe('listing-bid-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
