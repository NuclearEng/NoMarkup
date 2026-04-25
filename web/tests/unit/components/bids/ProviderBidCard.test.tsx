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
});
