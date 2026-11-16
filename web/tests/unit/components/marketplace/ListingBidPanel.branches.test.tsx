// ListingBidPanel — branches the base suite (ListingBidPanel.test.tsx) leaves
// open: the 60s retract window (fake timers), the live-bid pulse and snipe
// flash, the bid-bond prompt host, the mobile dock variant, and the amount
// clamping / validation edges.
// MOCKED: BidBondPrompt (its Stripe flow has its own suite) and next/link.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

vi.mock('@/components/compliance/BidBondPrompt', () => ({
  BidBondPrompt: ({
    listingId,
    intendedBidCents,
    onAuthorized,
  }: {
    listingId: string;
    intendedBidCents: number;
    onAuthorized: () => void;
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'bond-prompt',
        'data-listing-id': listingId,
        'data-intended-bid': String(intendedBidCents),
        onClick: onAuthorized,
      },
      'Authorize bond',
    ),
}));

import { ListingBidPanel } from '@/components/marketplace/ListingBidPanel';

const NOW = new Date('2026-05-01T12:00:00.000Z');

function baseProps() {
  return {
    currentBidCents: 5000,
    minIncrementCents: 100,
    isAuthenticated: true,
    isOwnListing: false,
    isUserWinning: false,
    isSubmitting: false,
    isAuctionExpired: false,
    onPlaceBid: vi.fn<(amountCents: number, maxBidCents?: number) => void>(),
  };
}

/** A winning bid placed `ageMs` before NOW. */
function bidPlacedAgo(ageMs: number) {
  return { bidId: 'bid-1', createdAt: new Date(NOW.getTime() - ageMs).toISOString() };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function bidInput(): HTMLElement {
  return screen.getByLabelText(/Bid amount/);
}

function maxInput(): HTMLElement {
  return screen.getByLabelText(/Set max bid/);
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Bid \$/ });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ListingBidPanel — retract window', () => {
  it('offers Retract with the seconds left in the 60s window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <ListingBidPanel
        {...baseProps()}
        isUserWinning
        retractableBid={bidPlacedAgo(18_000)}
        onRetractBid={vi.fn()}
      />,
    );
    const retract = screen.getByTestId('listing-retract-bid');
    expect(retract).toHaveTextContent('Retract bid (42s)');
    expect(retract).toHaveAccessibleName('Retract bid (42 seconds remaining)');
    expect(retract).toBeEnabled();
  });

  it('counts down and removes the control once the window closes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <ListingBidPanel
        {...baseProps()}
        isUserWinning
        retractableBid={bidPlacedAgo(57_000)}
        onRetractBid={vi.fn()}
      />,
    );
    expect(screen.getByTestId('listing-retract-bid')).toHaveTextContent('Retract bid (3s)');
    advance(2000);
    expect(screen.getByTestId('listing-retract-bid')).toHaveTextContent('Retract bid (1s)');
    advance(1000);
    expect(screen.queryByTestId('listing-retract-bid')).toBeNull();
  });

  it('calls onRetractBid when pressed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onRetractBid = vi.fn<() => void>();
    render(
      <ListingBidPanel
        {...baseProps()}
        isUserWinning
        retractableBid={bidPlacedAgo(1000)}
        onRetractBid={onRetractBid}
      />,
    );
    fireEvent.click(screen.getByTestId('listing-retract-bid'));
    expect(onRetractBid).toHaveBeenCalledTimes(1);
  });

  it('shows "Retracting…" and disables the control while the retract is in flight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <ListingBidPanel
        {...baseProps()}
        isUserWinning
        isRetracting
        retractableBid={bidPlacedAgo(1000)}
        onRetractBid={vi.fn()}
      />,
    );
    const retract = screen.getByTestId('listing-retract-bid');
    expect(retract).toHaveTextContent('Retracting…');
    expect(retract).toBeDisabled();
  });

  it('disables Retract while a new bid is being submitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <ListingBidPanel
        {...baseProps()}
        isUserWinning
        isSubmitting
        retractableBid={bidPlacedAgo(1000)}
        onRetractBid={vi.fn()}
      />,
    );
    expect(screen.getByTestId('listing-retract-bid')).toBeDisabled();
  });

  it.each([
    ['the bid is older than 60 seconds', { retractableBid: bidPlacedAgo(60_000) }],
    ['the bid timestamp is unparseable', { retractableBid: { bidId: 'b', createdAt: 'nope' } }],
    ['the viewer is no longer winning', { isUserWinning: false }],
    ['there is no retractable bid', { retractableBid: null }],
    ['no retract handler is wired', { onRetractBid: undefined }],
  ])('hides Retract when %s', (_label, overrides) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <ListingBidPanel
        {...baseProps()}
        isUserWinning
        retractableBid={bidPlacedAgo(1000)}
        onRetractBid={vi.fn()}
        {...overrides}
      />,
    );
    expect(screen.queryByTestId('listing-retract-bid')).toBeNull();
    expect(screen.getByText('Place your bid')).toBeInTheDocument();
  });

  it('drops Retract as soon as the viewer is outbid', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const props = { ...baseProps(), retractableBid: bidPlacedAgo(1000), onRetractBid: vi.fn() };
    const { rerender } = render(<ListingBidPanel {...props} isUserWinning />);
    expect(screen.getByTestId('listing-retract-bid')).toBeInTheDocument();
    rerender(<ListingBidPanel {...props} isUserWinning={false} />);
    expect(screen.queryByTestId('listing-retract-bid')).toBeNull();
  });
});

describe('ListingBidPanel — live bid highlight', () => {
  it('does not pulse when no live bid has arrived', () => {
    const { container } = render(<ListingBidPanel {...baseProps()} />);
    expect(container.querySelector('[data-live-pulse]')).toHaveAttribute(
      'data-live-pulse',
      'false',
    );
  });

  it('pulses for 3 seconds after a live bid, then settles', () => {
    vi.useFakeTimers();
    const { container } = render(
      <ListingBidPanel {...baseProps()} lastLiveBidTimestamp="2026-05-01T12:00:00Z" />,
    );
    const panel = container.querySelector('[data-live-pulse]');
    expect(panel).toHaveAttribute('data-live-pulse', 'true');
    advance(2999);
    expect(panel).toHaveAttribute('data-live-pulse', 'true');
    advance(1);
    expect(panel).toHaveAttribute('data-live-pulse', 'false');
  });

  it('restarts the 3 second pulse when another live bid arrives', () => {
    vi.useFakeTimers();
    const props = baseProps();
    const { container, rerender } = render(
      <ListingBidPanel {...props} lastLiveBidTimestamp="2026-05-01T12:00:00Z" />,
    );
    const panel = container.querySelector('[data-live-pulse]');
    advance(2000);
    rerender(<ListingBidPanel {...props} lastLiveBidTimestamp="2026-05-01T12:00:02Z" />);
    advance(2000);
    // 4s after the first bid, but only 2s after the second.
    expect(panel).toHaveAttribute('data-live-pulse', 'true');
    advance(1000);
    expect(panel).toHaveAttribute('data-live-pulse', 'false');
  });

  it('flashes "+30s — auction extended" only while the pulse is live', () => {
    vi.useFakeTimers();
    render(
      <ListingBidPanel
        {...baseProps()}
        lastLiveBidTimestamp="2026-05-01T12:00:00Z"
        lastLiveBidExtended
      />,
    );
    expect(screen.getByTestId('snipe-extension-flash')).toHaveTextContent(
      '+30s — auction extended',
    );
    advance(3000);
    expect(screen.queryByTestId('snipe-extension-flash')).toBeNull();
  });

  it('shows no extension flash for a live bid that did not extend the auction', () => {
    vi.useFakeTimers();
    render(<ListingBidPanel {...baseProps()} lastLiveBidTimestamp="2026-05-01T12:00:00Z" />);
    expect(screen.queryByTestId('snipe-extension-flash')).toBeNull();
  });
});

describe('ListingBidPanel — bid bond prompt', () => {
  it('shows the bond amount and hands the prompt the listing and intended bid', () => {
    render(
      <ListingBidPanel
        {...baseProps()}
        listingId="l-9"
        bidBondRequirement={{ bond_amount_cents: 2500 }}
      />,
    );
    const host = screen.getByTestId('bid-bond-prompt-host');
    expect(host).toHaveTextContent('One-time bid bond ($25.00)');
    const prompt = within(host).getByTestId('bond-prompt');
    expect(prompt).toHaveAttribute('data-listing-id', 'l-9');
    expect(prompt).toHaveAttribute('data-intended-bid', '5100');
  });

  it('keeps the intended bid in step with the amount field', () => {
    render(
      <ListingBidPanel
        {...baseProps()}
        listingId="l-9"
        bidBondRequirement={{ bond_amount_cents: 2500 }}
      />,
    );
    fireEvent.change(bidInput(), { target: { value: '64.5' } });
    expect(screen.getByTestId('bond-prompt')).toHaveAttribute('data-intended-bid', '6450');
  });

  it('notifies the parent once the bond is authorized', () => {
    const onBidBondAuthorized = vi.fn<() => void>();
    render(
      <ListingBidPanel
        {...baseProps()}
        listingId="l-9"
        bidBondRequirement={{ bond_amount_cents: 2500 }}
        onBidBondAuthorized={onBidBondAuthorized}
      />,
    );
    fireEvent.click(screen.getByTestId('bond-prompt'));
    expect(onBidBondAuthorized).toHaveBeenCalledTimes(1);
  });

  it('tolerates authorization when the parent wired no callback', () => {
    render(
      <ListingBidPanel
        {...baseProps()}
        listingId="l-9"
        bidBondRequirement={{ bond_amount_cents: 2500 }}
      />,
    );
    fireEvent.click(screen.getByTestId('bond-prompt'));
    expect(screen.getByTestId('bid-bond-prompt-host')).toBeInTheDocument();
  });

  it.each([
    ['no bond is required', { listingId: 'l-9', bidBondRequirement: null }],
    ['the listing id is unknown', { bidBondRequirement: { bond_amount_cents: 2500 } }],
  ])('renders no bond prompt when %s', (_label, overrides) => {
    render(<ListingBidPanel {...baseProps()} {...overrides} />);
    expect(screen.queryByTestId('bid-bond-prompt-host')).toBeNull();
  });
});

describe('ListingBidPanel — amounts and validation', () => {
  it('enforces a $1 minimum step even when the listing increment is smaller', () => {
    render(<ListingBidPanel {...baseProps()} minIncrementCents={25} />);
    expect(screen.getByText('Bid amount (min $51.00)')).toBeInTheDocument();
    expect(bidInput()).toHaveValue(51);
  });

  it('uses the listing increment when it is larger than $1', () => {
    render(<ListingBidPanel {...baseProps()} minIncrementCents={500} />);
    expect(screen.getByText('Bid amount (min $55.00)')).toBeInTheDocument();
    expect(submitButton()).toHaveTextContent('Bid $55.00');
  });

  it('names the minimum in the too-low error and clears it on the next edit', () => {
    const props = baseProps();
    render(<ListingBidPanel {...props} />);
    fireEvent.change(bidInput(), { target: { value: '50.99' } });
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Bid must be at least $51.00');
    expect(props.onPlaceBid).not.toHaveBeenCalled();

    fireEvent.change(bidInput(), { target: { value: '52' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bidInput()).toHaveAttribute('aria-invalid', 'false');
  });

  it('asks for an amount when the field is cleared', () => {
    const props = baseProps();
    render(<ListingBidPanel {...props} />);
    fireEvent.change(bidInput(), { target: { value: '' } });
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a bid amount');
    expect(props.onPlaceBid).not.toHaveBeenCalled();
  });

  it('keeps the button label at the minimum while the typed amount is below it', () => {
    render(<ListingBidPanel {...baseProps()} />);
    fireEvent.change(bidInput(), { target: { value: '10' } });
    expect(submitButton()).toHaveTextContent('Bid $51.00');
    fireEvent.change(bidInput(), { target: { value: '75.5' } });
    expect(submitButton()).toHaveTextContent('Bid $75.50');
  });

  it('clears a max-bid error when the max field is edited', () => {
    render(<ListingBidPanel {...baseProps()} />);
    fireEvent.change(bidInput(), { target: { value: '60' } });
    fireEvent.change(maxInput(), { target: { value: '55' } });
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Max bid cannot be below your bid');
    fireEvent.change(maxInput(), { target: { value: '90' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('raises the max ceiling with the bid so it never sits below it', () => {
    const props = baseProps();
    render(<ListingBidPanel {...props} />);
    fireEvent.change(bidInput(), { target: { value: '80' } });
    expect(maxInput()).toHaveValue(80);
    fireEvent.click(submitButton());
    // Max equals the bid, so no autobid headroom is forwarded.
    expect(props.onPlaceBid).toHaveBeenCalledWith(8000);
  });

  it('a quick increment clears a validation error and never drops below the minimum', () => {
    render(<ListingBidPanel {...baseProps()} />);
    fireEvent.change(bidInput(), { target: { value: '10' } });
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+$5' }));
    expect(screen.queryByRole('alert')).toBeNull();
    // $10 + $5 is still under the $51 minimum, so the field snaps to it.
    expect(bidInput()).toHaveValue(51);
  });

  it('lifts both fields to the new minimum when someone else outbids the viewer', () => {
    const props = baseProps();
    const { rerender } = render(<ListingBidPanel {...props} />);
    rerender(<ListingBidPanel {...props} currentBidCents={9000} />);
    expect(bidInput()).toHaveValue(91);
    expect(maxInput()).toHaveValue(91);
    expect(screen.getByText('Bid amount (min $91.00)')).toBeInTheDocument();
  });

  it('keeps a higher typed bid and max when the minimum moves up beneath them', () => {
    const props = baseProps();
    const { rerender } = render(<ListingBidPanel {...props} />);
    fireEvent.change(bidInput(), { target: { value: '150' } });
    fireEvent.change(maxInput(), { target: { value: '200' } });
    rerender(<ListingBidPanel {...props} currentBidCents={9000} />);
    expect(bidInput()).toHaveValue(150);
    expect(maxInput()).toHaveValue(200);
  });

  it('disables the submit button while a bid is in flight', () => {
    render(<ListingBidPanel {...baseProps()} isSubmitting />);
    expect(screen.getByRole('button', { name: /Placing bid/ })).toBeDisabled();
  });

  it('shows no winning badge or auto-bid label to a bidder who is not winning', () => {
    render(<ListingBidPanel {...baseProps()} userMaxBidCents={20_000} />);
    expect(screen.queryByText(/re winning/)).toBeNull();
    expect(screen.queryByTestId('autobid-active-label')).toBeNull();
  });

  it('shows no auto-bid label when the winner has no standing max', () => {
    render(<ListingBidPanel {...baseProps()} isUserWinning userMaxBidCents={null} />);
    expect(screen.getByRole('status')).toHaveTextContent(/re winning/);
    expect(screen.queryByTestId('autobid-active-label')).toBeNull();
  });
});

describe('ListingBidPanel — gate order', () => {
  it('tells the seller they cannot bid even after the auction ended', () => {
    render(<ListingBidPanel {...baseProps()} isOwnListing isAuctionExpired className="mt-9" />);
    const notice = screen.getByText(/You are the seller/);
    expect(notice).toHaveClass('mt-9');
    expect(screen.queryByText(/Auction has ended/)).toBeNull();
  });

  it('tells a signed-out visitor the auction ended rather than asking them to sign in', () => {
    render(
      <ListingBidPanel {...baseProps()} isAuthenticated={false} isAuctionExpired className="mt-9" />,
    );
    expect(screen.getByText('Auction has ended. Bidding is closed.')).toHaveClass('mt-9');
    expect(screen.queryByRole('link', { name: 'Sign in to bid' })).toBeNull();
  });

  it('shows no bid form to a signed-out visitor', () => {
    render(<ListingBidPanel {...baseProps()} isAuthenticated={false} />);
    expect(screen.getByRole('link', { name: 'Sign in to bid' })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('Place your bid')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});

describe('ListingBidPanel — dock variant', () => {
  function dockBid(): HTMLElement {
    return screen.getByLabelText(/^Bid \(min/);
  }
  function dockMax(): HTMLElement {
    return screen.getByLabelText('Max (opt)');
  }

  it('renders the compact form with the minimum in the label and the disclosure', () => {
    render(<ListingBidPanel {...baseProps()} variant="dock" />);
    const dock = screen.getByTestId('listing-bid-dock');
    expect(within(dock).getByText('Bid (min $51.00)')).toBeInTheDocument();
    expect(dockBid()).toHaveValue(51);
    expect(dockMax()).toHaveValue(51);
    expect(within(dock).getByTestId('bid-auth-disclosure')).toHaveTextContent(
      /authorizes NoMarkup to charge your saved payment method/i,
    );
    // The roomy default-layout fields are not rendered twice.
    expect(screen.queryByLabelText(/Set max bid/)).toBeNull();
  });

  it('submits the typed bid in cents', () => {
    const props = baseProps();
    render(<ListingBidPanel {...props} variant="dock" />);
    fireEvent.change(dockBid(), { target: { value: '62.25' } });
    fireEvent.click(submitButton());
    expect(props.onPlaceBid).toHaveBeenCalledWith(6225);
  });

  it('forwards a max bid set above the visible bid', () => {
    const props = baseProps();
    render(<ListingBidPanel {...props} variant="dock" />);
    fireEvent.change(dockMax(), { target: { value: '120' } });
    fireEvent.click(submitButton());
    expect(props.onPlaceBid).toHaveBeenCalledWith(5100, 12_000);
  });

  it('applies quick increments to the dock amount', () => {
    render(<ListingBidPanel {...baseProps()} variant="dock" />);
    fireEvent.click(screen.getByRole('button', { name: '+$20' }));
    expect(dockBid()).toHaveValue(71);
    expect(submitButton()).toHaveTextContent('Bid $71.00');
  });

  it('shows the too-low error inline and clears it when the bid is edited', () => {
    const props = baseProps();
    render(<ListingBidPanel {...props} variant="dock" />);
    fireEvent.change(dockBid(), { target: { value: '5' } });
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Bid must be at least $51.00');
    expect(dockBid()).toHaveAttribute('aria-invalid', 'true');
    expect(props.onPlaceBid).not.toHaveBeenCalled();
    fireEvent.change(dockBid(), { target: { value: '55' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the max-below-bid error and clears it when the max is edited', () => {
    render(<ListingBidPanel {...baseProps()} variant="dock" />);
    fireEvent.change(dockBid(), { target: { value: '70' } });
    fireEvent.change(dockMax(), { target: { value: '60' } });
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Max bid cannot be below your bid');
    fireEvent.change(dockMax(), { target: { value: '95' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces the bid label with a disabled spinner button while submitting', () => {
    render(<ListingBidPanel {...baseProps()} variant="dock" isSubmitting />);
    expect(screen.queryByRole('button', { name: /^Bid \$/ })).toBeNull();
    const disabled = screen.getAllByRole('button').filter((b) => b.hasAttribute('disabled'));
    expect(disabled).toHaveLength(1);
    expect(disabled[0]).not.toHaveTextContent('+$');
  });

  it('never shows Retract in the dock, even inside the retract window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <ListingBidPanel
        {...baseProps()}
        variant="dock"
        isUserWinning
        retractableBid={bidPlacedAgo(1000)}
        onRetractBid={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('listing-retract-bid')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/re winning/);
  });
});
