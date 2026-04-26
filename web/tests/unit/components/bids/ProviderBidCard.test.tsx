import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderBidCard } from '@/components/bids/ProviderBidCard';
import type { Bid } from '@/types';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/hooks/useBids', () => ({
  useUpdateBid: vi.fn(),
  useWithdrawBid: vi.fn(),
}));

const { useUpdateBid, useWithdrawBid } = await import('@/hooks/useBids');

const updateMutate = vi.fn();
const withdrawMutate = vi.fn();

function makeBid(overrides: Partial<Bid> = {}): Bid {
  return {
    id: 'bid-1',
    job_id: 'job-1',
    provider_id: 'prov-1',
    amount_cents: 20000,
    is_offer_accepted: false,
    status: 'active',
    original_amount_cents: 25000,
    bid_history: [],
    created_at: '2026-03-01T12:00:00Z',
    updated_at: '2026-03-01T12:00:00Z',
    awarded_at: null,
    withdrawn_at: null,
    ...overrides,
  };
}

describe('ProviderBidCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMutate.mockReset();
    withdrawMutate.mockReset();
    vi.mocked(useUpdateBid).mockReturnValue({
      mutate: updateMutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useUpdateBid>);
    vi.mocked(useWithdrawBid).mockReturnValue({
      mutate: withdrawMutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useWithdrawBid>);
  });

  it('renders the bid amount and status badge', () => {
    render(<ProviderBidCard bid={makeBid()} jobTitle="Plumbing job" />);
    expect(screen.getByText('Plumbing job')).toBeDefined();
    expect(screen.getByText('$200.00')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('renders Won badge for awarded bids', () => {
    render(<ProviderBidCard bid={makeBid({ status: 'awarded' })} jobTitle="Job" />);
    expect(screen.getByText('Won')).toBeDefined();
  });

  it('renders Withdrawn badge for withdrawn bids', () => {
    render(<ProviderBidCard bid={makeBid({ status: 'withdrawn' })} jobTitle="Job" />);
    expect(screen.getByText('Withdrawn')).toBeDefined();
  });

  it('shows the original price when amount changed', () => {
    render(
      <ProviderBidCard
        bid={makeBid({ amount_cents: 18000, original_amount_cents: 22000 })}
        jobTitle="Job"
      />,
    );
    expect(screen.getByText('Original')).toBeDefined();
    expect(screen.getByText('$220.00')).toBeDefined();
  });

  it('renders Lower Bid and Withdraw buttons for active bids', () => {
    render(<ProviderBidCard bid={makeBid()} jobTitle="Job" />);
    expect(screen.getByRole('button', { name: /lower bid/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeDefined();
  });

  it('hides action buttons for non-active bids', () => {
    render(<ProviderBidCard bid={makeBid({ status: 'withdrawn' })} jobTitle="Job" />);
    expect(screen.queryByRole('button', { name: /lower bid/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull();
  });

  it('opens the lower-bid form when Lower Bid is clicked', async () => {
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid()} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /lower bid/i }));
    expect(screen.getByText('New Amount (lower)')).toBeDefined();
    expect(screen.getByPlaceholderText('0.00')).toBeDefined();
  });

  it('opens the withdraw confirmation when Withdraw is clicked', async () => {
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid()} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
    expect(screen.getByText(/are you sure you want to withdraw/i)).toBeDefined();
  });

  it('calls withdrawBid.mutate after confirmation', async () => {
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid()} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
    await user.click(screen.getByRole('button', { name: /confirm withdraw/i }));
    expect(withdrawMutate).toHaveBeenCalledTimes(1);
  });

  it('rejects an update equal to or above the existing bid', async () => {
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid({ amount_cents: 20000 })} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /lower bid/i }));
    const input = screen.getByPlaceholderText('0.00');
    await user.type(input, '210');
    // The submit button inside the form is named "Lower Bid"
    const submits = screen.getAllByRole('button', { name: /^lower bid$/i });
    await user.click(submits[submits.length - 1] as HTMLElement);
    expect(updateMutate).not.toHaveBeenCalled();
  });

  // ---- DEEPENING TESTS ----

  it('renders the View Job link when no jobTitle is supplied', () => {
    render(<ProviderBidCard bid={makeBid()} />);
    expect(screen.getByText(/view job/i)).toBeDefined();
  });

  it('renders Not Selected badge for non-selected bids', () => {
    render(<ProviderBidCard bid={makeBid({ status: 'not_selected' })} jobTitle="Job" />);
    expect(screen.getByText('Not Selected')).toBeDefined();
  });

  it('renders Expired badge for expired bids', () => {
    render(<ProviderBidCard bid={makeBid({ status: 'expired' })} jobTitle="Job" />);
    expect(screen.getByText('Expired')).toBeDefined();
  });

  it('falls back to the raw status string for an unknown status', () => {
    render(<ProviderBidCard bid={makeBid({ status: 'pending_review' as Bid['status'] })} jobTitle="Job" />);
    expect(screen.getByText('pending review')).toBeDefined();
  });

  it('shows the Offer Accepted badge when the offer was accepted', () => {
    render(
      <ProviderBidCard
        bid={makeBid({ is_offer_accepted: true })}
        jobTitle="Job"
      />,
    );
    expect(screen.getByText(/offer accepted/i)).toBeDefined();
  });

  it('expands and collapses the bid history when the toggle is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ProviderBidCard
        bid={makeBid({
          amount_cents: 18000,
          original_amount_cents: 18000,
          bid_history: [
            { amount_cents: 25000, updated_at: '2026-03-01T10:00:00Z' },
            { amount_cents: 22000, updated_at: '2026-03-01T11:00:00Z' },
          ],
        })}
        jobTitle="Job"
      />,
    );
    const toggle = screen.getByRole('button', { name: /Bid History \(2 updates\)/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('$220.00')).toBeDefined();
    expect(screen.getByText(/\(original\)/i)).toBeDefined();
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('uses a singular "update" label when there is exactly one history entry', () => {
    render(
      <ProviderBidCard
        bid={makeBid({
          bid_history: [{ amount_cents: 25000, updated_at: '2026-03-01T10:00:00Z' }],
        })}
        jobTitle="Job"
      />,
    );
    expect(screen.getByRole('button', { name: /Bid History \(1 update\)/ })).toBeDefined();
  });

  it('shows withdrawn and awarded timestamps in the metadata line', () => {
    render(
      <ProviderBidCard
        bid={makeBid({
          status: 'awarded',
          awarded_at: '2026-03-02T10:00:00Z',
          withdrawn_at: '2026-03-03T10:00:00Z',
        })}
        jobTitle="Job"
      />,
    );
    expect(screen.getByText(/Awarded/)).toBeDefined();
    expect(screen.getByText(/Withdrawn/)).toBeDefined();
  });

  it('cancels the lower-bid form and clears the input', async () => {
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid()} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /lower bid/i }));
    const input = screen.getByPlaceholderText('0.00');
    await user.type(input, '15');
    // The Cancel button inside the lower-bid form
    const cancelBtns = screen.getAllByRole('button', { name: /^cancel$/i });
    await user.click(cancelBtns[0] as HTMLElement);
    // Form is closed; the Lower Bid action button is back
    expect(screen.getByRole('button', { name: /lower bid/i })).toBeDefined();
    expect(screen.queryByPlaceholderText('0.00')).toBeNull();
  });

  it('cancels the withdraw confirmation', async () => {
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid()} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
    expect(screen.getByText(/are you sure/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByText(/are you sure/i)).toBeNull();
  });

  it('sends a valid lower bid through the update mutation', async () => {
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid({ amount_cents: 20000 })} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /lower bid/i }));
    const input = screen.getByPlaceholderText('0.00');
    await user.type(input, '150');
    const submits = screen.getAllByRole('button', { name: /^lower bid$/i });
    await user.click(submits[submits.length - 1] as HTMLElement);
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [args] = updateMutate.mock.calls[0] as [
      { bidId: string; input: { new_amount_cents: number } },
    ];
    expect(args.bidId).toBe('bid-1');
    expect(args.input.new_amount_cents).toBe(15000);
  });

  it('renders a disabled Confirm Withdraw button while the mutation is pending', async () => {
    vi.mocked(useWithdrawBid).mockReturnValue({
      mutate: withdrawMutate,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useWithdrawBid>);
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid()} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
    const confirmBtn = screen.getByRole('button', { name: /confirm withdraw/i });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
  });

  it('renders a withdraw error notice when the mutation flags isError', async () => {
    vi.mocked(useWithdrawBid).mockReturnValue({
      mutate: withdrawMutate,
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof useWithdrawBid>);
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid()} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
    expect(screen.getByText(/Failed to withdraw bid/i)).toBeDefined();
  });

  it('renders an update error notice when the lower-bid mutation flags isError', async () => {
    vi.mocked(useUpdateBid).mockReturnValue({
      mutate: updateMutate,
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof useUpdateBid>);
    const user = userEvent.setup();
    render(<ProviderBidCard bid={makeBid()} jobTitle="Job" />);
    await user.click(screen.getByRole('button', { name: /lower bid/i }));
    expect(screen.getByText(/Failed to update bid/i)).toBeDefined();
  });
});
