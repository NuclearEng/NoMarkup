import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom's localStorage methods aren't always bound to the Storage instance,
// which causes "window.localStorage.getItem is not a function" once
// BidForm reads its persisted step on mount. Install an in-memory shim.
const memoryStore = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    get length() {
      return memoryStore.size;
    },
    clear: () => {
      memoryStore.clear();
    },
    getItem: (key: string) => memoryStore.get(key) ?? null,
    key: (i: number) => Array.from(memoryStore.keys())[i] ?? null,
    removeItem: (key: string) => {
      memoryStore.delete(key);
    },
    setItem: (key: string, value: string) => {
      memoryStore.set(key, value);
    },
  } satisfies Storage,
});

import { BidForm } from '@/components/bids/BidForm';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/hooks/useBids', () => ({
  usePlaceBid: vi.fn(),
  useUpdateBid: vi.fn(),
  useAcceptOffer: vi.fn(),
}));

// Stub out child components that pull in their own data layer
vi.mock('@/components/bids/BidSuggestion', () => ({
  BidSuggestion: () => null,
}));
vi.mock('@/components/jobs/MarketRangeDisplay', () => ({
  MarketRangeDisplay: () => null,
}));

const { usePlaceBid, useUpdateBid, useAcceptOffer } = await import('@/hooks/useBids');

const mutateMock = vi.fn();
const updateMutateMock = vi.fn();
const acceptMutateMock = vi.fn();

const futureAuctionEnd = new Date(Date.now() + 86_400_000).toISOString();
const pastAuctionEnd = new Date(Date.now() - 1000).toISOString();

describe('BidForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateMock.mockReset();
    updateMutateMock.mockReset();
    acceptMutateMock.mockReset();

    vi.mocked(usePlaceBid).mockReturnValue({
      mutate: mutateMock,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof usePlaceBid>);
    vi.mocked(useUpdateBid).mockReturnValue({
      mutate: updateMutateMock,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useUpdateBid>);
    vi.mocked(useAcceptOffer).mockReturnValue({
      mutate: acceptMutateMock,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptOffer>);
  });

  it('renders the bid amount label and Place Bid button when no existing bid', () => {
    render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={50000}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );
    expect(screen.getByText('Your Bid Amount')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Place Bid' })).toBeDefined();
  });

  it('shows the auction-closed message when the auction has ended', () => {
    render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={50000}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={pastAuctionEnd}
      />,
    );
    expect(screen.getByText('Auction Closed')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Place Bid' })).toBeNull();
  });

  it('rejects a bid amount equal to or above the starting bid', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={10000}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );

    const input = screen.getByPlaceholderText('0.00');
    await user.type(input, '150');
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText(/must be less than the starting bid of \$100\.00/i)).toBeDefined();
    });
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('opens the confirmation step on a valid bid', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={10000}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );
    const input = screen.getByPlaceholderText('0.00');
    await user.type(input, '50');
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText(/confirm your bid/i)).toBeDefined();
    });
  });

  it('calls placeBid with the correct cents payload after confirmation', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={10000}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );

    const input = screen.getByPlaceholderText('0.00');
    await user.type(input, '75');
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText(/confirm your bid/i)).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: /confirm bid/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const [args] = mutateMock.mock.calls[0] as [{ jobId: string; input: { amount_cents: number } }];
    expect(args.jobId).toBe('job-1');
    expect(args.input.amount_cents).toBe(7500);
  });

  it('increments the bid amount when the plus button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={50000}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );

    const input = screen.getByPlaceholderText('0.00');
    fireEvent.change(input, { target: { value: '100' } });
    // Default step is $10
    await user.click(screen.getByLabelText('Increase bid by $10'));
    expect(input.value).toBe('110');
  });

  it('decrements the bid amount when the minus button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={50000}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );

    const input = screen.getByPlaceholderText('0.00');
    fireEvent.change(input, { target: { value: '100' } });
    await user.click(screen.getByLabelText('Decrease bid by $10'));
    expect(input.value).toBe('90');
  });

  it('renders the existing-bid summary and switches submit button to "Lower Bid"', () => {
    render(
      <BidForm
        jobId="job-1"
        existingBid={{
          id: 'bid-1',
          job_id: 'job-1',
          provider_id: 'prov-1',
          amount_cents: 8000,
          is_offer_accepted: false,
          status: 'active',
          original_amount_cents: 8000,
          bid_history: [],
          created_at: '2026-03-01T12:00:00Z',
          updated_at: '2026-03-01T12:00:00Z',
          awarded_at: null,
          withdrawn_at: null,
        }}
        startingBidCents={10000}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );

    expect(screen.getByText('Your Current Bid')).toBeDefined();
    expect(screen.getByRole('button', { name: /lower bid/i })).toBeDefined();
  });

  it('blocks an update equal to or above the existing bid', async () => {
    const user = userEvent.setup();
    render(
      <BidForm
        jobId="job-1"
        existingBid={{
          id: 'bid-1',
          job_id: 'job-1',
          provider_id: 'prov-1',
          amount_cents: 8000,
          is_offer_accepted: false,
          status: 'active',
          original_amount_cents: 8000,
          bid_history: [],
          created_at: '2026-03-01T12:00:00Z',
          updated_at: '2026-03-01T12:00:00Z',
          awarded_at: null,
          withdrawn_at: null,
        }}
        startingBidCents={10000}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );

    const input = screen.getByPlaceholderText('0.00');
    await user.type(input, '90');
    const form = input.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText(/you can only lower your bid/i)).toBeDefined();
    });
    expect(updateMutateMock).not.toHaveBeenCalled();
  });

  it('renders Accept Offer panel when offerAcceptedCents is set and there is no existing bid', () => {
    render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={50000}
        offerAcceptedCents={20000}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );
    expect(screen.getByText('Instant Accept')).toBeDefined();
    expect(screen.getByRole('button', { name: /accept offer at \$200/i })).toBeDefined();
  });
});
