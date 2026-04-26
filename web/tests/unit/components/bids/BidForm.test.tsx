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
  MarketRangeDisplay: () => <div data-testid="mock-market-range" />,
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
    if (!(input instanceof HTMLInputElement)) throw new Error('expected input element');
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
    if (!(input instanceof HTMLInputElement)) throw new Error('expected input element');
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

  // ---- DEEPENING TESTS ----

  it('reveals the accept-offer confirmation when the Accept Offer button is clicked', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: /accept offer at \$200/i }));
    expect(screen.getByText(/Are you sure\? This will place a bid at \$200/i)).toBeDefined();
  });

  it('calls acceptOffer.mutate after the accept-offer confirmation is confirmed', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: /accept offer at \$200/i }));
    await user.click(screen.getByRole('button', { name: /confirm accept offer/i }));
    expect(acceptMutateMock).toHaveBeenCalledTimes(1);
    const [args] = acceptMutateMock.mock.calls[0] as [string];
    expect(args).toBe('job-1');
  });

  it('cancels the accept-offer confirmation', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: /accept offer at \$200/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.getByRole('button', { name: /accept offer at \$200/i })).toBeDefined();
  });

  it('hides the Accept Offer panel when the provider already has a bid', () => {
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
        offerAcceptedCents={20000}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );
    expect(screen.queryByText('Instant Accept')).toBeNull();
  });

  it('renders an error message when the accept-offer mutation flags isError', async () => {
    vi.mocked(useAcceptOffer).mockReturnValue({
      mutate: acceptMutateMock,
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof useAcceptOffer>);
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: /accept offer at \$200/i }));
    expect(screen.getByText(/Failed to accept offer/i)).toBeDefined();
  });

  it('disables the Confirm Accept Offer button while the mutation is pending', async () => {
    vi.mocked(useAcceptOffer).mockReturnValue({
      mutate: acceptMutateMock,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useAcceptOffer>);
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: /accept offer at \$200/i }));
    const confirmBtn = screen.getByRole('button', { name: /accepting offer/i });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
  });

  it('shows a confirmation error message when the place-bid mutation flags isError', async () => {
    vi.mocked(usePlaceBid).mockReturnValue({
      mutate: mutateMock,
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof usePlaceBid>);
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
    expect(screen.getByText(/Failed to submit bid/i)).toBeDefined();
  });

  it('cancels the bid confirmation step and returns to the form', async () => {
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
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => {
      expect(screen.getByText(/confirm your bid/i)).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByText(/confirm your bid/i)).toBeNull();
    expect(screen.getByPlaceholderText('0.00')).toBeDefined();
  });

  it('calls updateBid with the lowered cents on confirmation when an existing bid exists', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BidForm
        jobId="job-1"
        existingBid={{
          id: 'bid-existing',
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
    // Field defaults to existing bid value (80). Use fireEvent.change to set
    // a lower value cleanly — userEvent.type on a controlled number input is
    // known to drop digits.
    const input = screen.getByDisplayValue('80');
    fireEvent.change(input, { target: { value: '50' } });
    const form = container.querySelector('form');
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => {
      expect(screen.getByText(/confirm lower bid/i)).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: /confirm lower bid/i }));
    expect(updateMutateMock).toHaveBeenCalledTimes(1);
    const [args] = updateMutateMock.mock.calls[0] as [
      { bidId: string; input: { new_amount_cents: number } },
    ];
    expect(args.bidId).toBe('bid-existing');
    expect(args.input.new_amount_cents).toBe(5000);
  });

  it('persists a custom step value to localStorage when the step input changes', () => {
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
    const stepInput = screen.getByLabelText('Bid increment in dollars');
    fireEvent.change(stepInput, { target: { value: '25' } });
    expect(globalThis.localStorage.getItem('nomarkup.bidStepDollars')).toBe('25');
  });

  // ---- WAVE 13 DEEPENING TESTS ----

  it('rehydrates the step value from localStorage on mount', () => {
    globalThis.localStorage.setItem('nomarkup.bidStepDollars', '25');
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
    const stepInput = screen.getByLabelText<HTMLInputElement>('Bid increment in dollars');
    expect(stepInput.value).toBe('25');
    // The Increase/Decrease aria-labels include the step value
    expect(screen.getByLabelText('Increase bid by $25')).toBeDefined();
    globalThis.localStorage.removeItem('nomarkup.bidStepDollars');
  });

  it('ignores a non-finite stored step value and keeps the default', () => {
    globalThis.localStorage.setItem('nomarkup.bidStepDollars', 'not-a-number');
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
    const stepInput = screen.getByLabelText<HTMLInputElement>('Bid increment in dollars');
    expect(stepInput.value).toBe('10');
    globalThis.localStorage.removeItem('nomarkup.bidStepDollars');
  });

  it('renders the market range panel when sample_size > 0', () => {
    render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={50000}
        offerAcceptedCents={null}
        marketRange={{ low_cents: 1000, median_cents: 2000, high_cents: 3000, sample_size: 5 }}
        auctionEndsAt={futureAuctionEnd}
      />,
    );
    expect(screen.getByTestId('mock-market-range')).toBeDefined();
  });

  it('omits the "must be less than" hint when there is no starting bid', () => {
    render(
      <BidForm
        jobId="job-1"
        existingBid={null}
        startingBidCents={null}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );
    expect(screen.getByText(/Enter your bid in dollars/)).toBeDefined();
    expect(screen.queryByText(/must be less than/i)).toBeNull();
  });

  it('shows the loading label and disables submit while placeBid is pending', () => {
    vi.mocked(usePlaceBid).mockReturnValue({
      mutate: mutateMock,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof usePlaceBid>);
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
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: /placing bid/i });
    expect(submit.disabled).toBe(true);
  });

  it('shows the lowering label while updateBid is pending and existing bid exists', () => {
    vi.mocked(useUpdateBid).mockReturnValue({
      mutate: updateMutateMock,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useUpdateBid>);
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
    expect(screen.getByRole('button', { name: /lowering bid/i })).toBeDefined();
  });

  it('shows the confirm-step pending label while update mutation runs', async () => {
    const user = userEvent.setup();
    vi.mocked(useUpdateBid).mockReturnValue({
      mutate: updateMutateMock,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useUpdateBid>);
    const { container } = render(
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
    // Set lower bid then submit to enter confirm step
    const input = screen.getByDisplayValue('80');
    fireEvent.change(input, { target: { value: '50' } });
    const form = container.querySelector('form');
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => {
      expect(screen.getByText(/Confirming/i)).toBeDefined();
    });
    // The disabled state pairs with the loading label.
    const cancelBtn = screen.getByRole<HTMLButtonElement>('button', { name: /^cancel$/i });
    expect(cancelBtn.disabled).toBe(true);
    // Avoid an unused-var lint flag.
    void user;
  });

  it('closes the confirm dialog after a successful place-bid mutation', async () => {
    const user = userEvent.setup();
    // Configure mutate to invoke onSuccess immediately so the success branch fires.
    mutateMock.mockImplementation(
      (
        _vars: { jobId: string; input: { amount_cents: number } },
        opts?: { onSuccess?: () => void },
      ) => {
        opts?.onSuccess?.();
      },
    );
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
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => {
      expect(screen.getByText(/confirm your bid/i)).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: /confirm bid/i }));
    // After onSuccess fires, showConfirm flips back to false → form returns.
    await waitFor(() => {
      expect(screen.queryByText(/confirm your bid/i)).toBeNull();
    });
  });

  it('closes the update-confirm dialog after a successful update mutation', async () => {
    const user = userEvent.setup();
    updateMutateMock.mockImplementation(
      (
        _vars: { bidId: string; input: { new_amount_cents: number } },
        opts?: { onSuccess?: () => void },
      ) => {
        opts?.onSuccess?.();
      },
    );
    const { container } = render(
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
    const input = screen.getByDisplayValue('80');
    fireEvent.change(input, { target: { value: '50' } });
    const form = container.querySelector('form');
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => {
      expect(screen.getByText(/confirm lower bid/i)).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: /confirm lower bid/i }));
    await waitFor(() => {
      expect(screen.queryByText(/confirm lower bid/i)).toBeNull();
    });
  });

  it('rejects an update equal to or above the existing bid amount', async () => {
    const { container } = render(
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
        // No startingBidCents → the first guard in validateBidAmount is
        // skipped, so the existing-bid guard is the one that fires.
        startingBidCents={null}
        offerAcceptedCents={null}
        marketRange={null}
        auctionEndsAt={futureAuctionEnd}
      />,
    );
    // Set the field to exactly the existing bid amount ($80) — which is not
    // strictly less, so the validator must reject.
    const input = screen.getByDisplayValue('80');
    fireEvent.change(input, { target: { value: '80' } });
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText(/You can only lower your bid\. Current bid: \$80\.00/)).toBeDefined();
    });
    expect(updateMutateMock).not.toHaveBeenCalled();
  });

  it('closes the accept-offer confirmation after a successful accept mutation', async () => {
    const user = userEvent.setup();
    acceptMutateMock.mockImplementation(
      (_vars: string, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
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
    await user.click(screen.getByRole('button', { name: /accept offer at \$200/i }));
    await user.click(screen.getByRole('button', { name: /confirm accept offer/i }));
    // After onSuccess, the confirmation collapses back to the original button.
    expect(
      screen.queryByRole('button', { name: /confirm accept offer/i }),
    ).toBeNull();
  });
});
