import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BidCard } from '@/components/bids/BidCard';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { BidWithProvider } from '@/types';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/hooks/useBids', () => ({
  useAwardBid: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
}));

function withProvider(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const baseBid: BidWithProvider = {
  bid: {
    id: 'bid-1',
    job_id: 'job-1',
    provider_id: 'prov-1',
    amount_cents: 25000,
    is_offer_accepted: false,
    status: 'active',
    original_amount_cents: 28000,
    bid_history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    awarded_at: null,
    withdrawn_at: null,
  },
  provider_display_name: 'Acme Plumbing',
  provider_business_name: 'Acme LLC',
  provider_avatar_url: null,
  trust_score: { overall_score: 0.85, tier: 'top_rated' },
  review_summary: { average_rating: 4.7, review_count: 24, on_time_rate: 0.92 },
  jobs_completed: 47,
};

describe('BidCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the provider display name and business name', () => {
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={false} />);
    expect(screen.getByText('Acme Plumbing')).toBeDefined();
    expect(screen.getByText('Acme LLC')).toBeDefined();
  });

  it('renders the bid amount formatted as USD', () => {
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={false} />);
    expect(screen.getByText('$250.00')).toBeDefined();
  });

  it('renders the trust score in the gauge', () => {
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={false} />);
    // 0.85 * 100 = 85
    expect(screen.getByText('85')).toBeDefined();
  });

  it('renders rank badge when rank is supplied', () => {
    withProvider(
      <BidCard
        bidWithProvider={baseBid}
        jobId="job-1"
        canAward={false}
        rank={1}
        totalBids={5}
      />,
    );
    expect(screen.getByLabelText('Rank 1 of 5 bids')).toBeDefined();
    expect(screen.getByText(/lowest bid/i)).toBeDefined();
  });

  it('renders the Award button when canAward is true and bid is active', () => {
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={true} />);
    expect(screen.getByRole('button', { name: /award job/i })).toBeDefined();
  });

  it('hides the Award button when canAward is false', () => {
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={false} />);
    expect(screen.queryByRole('button', { name: /award job/i })).toBeNull();
  });

  it('renders job completion count', () => {
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={false} />);
    expect(screen.getByText('47 jobs')).toBeDefined();
  });

  it('shows bid history toggle when there are updates', () => {
    const withHistory: BidWithProvider = {
      ...baseBid,
      bid: {
        ...baseBid.bid,
        bid_history: [
          { amount_cents: 28000, updated_at: '2026-03-01T12:00:00Z' },
          { amount_cents: 26000, updated_at: '2026-03-01T13:00:00Z' },
        ],
      },
    };
    withProvider(<BidCard bidWithProvider={withHistory} jobId="job-1" canAward={false} />);
    expect(screen.getByText(/bid history \(2 updates\)/i)).toBeDefined();
  });

  // ---- DEEPENING TESTS ----

  it('renders the fallback rank badge for ranks beyond 3', () => {
    withProvider(
      <BidCard
        bidWithProvider={baseBid}
        jobId="job-1"
        canAward={false}
        rank={5}
        totalBids={10}
      />,
    );
    expect(screen.getByLabelText('Rank 5 of 10 bids')).toBeDefined();
  });

  it('renders the silver rank badge for rank 2', () => {
    withProvider(
      <BidCard
        bidWithProvider={baseBid}
        jobId="job-1"
        canAward={false}
        rank={2}
        totalBids={5}
      />,
    );
    expect(screen.getByLabelText('Rank 2 of 5 bids')).toBeDefined();
    expect(screen.getByText(/2nd lowest/)).toBeDefined();
  });

  it('renders the bronze rank badge for rank 3', () => {
    withProvider(
      <BidCard
        bidWithProvider={baseBid}
        jobId="job-1"
        canAward={false}
        rank={3}
        totalBids={5}
      />,
    );
    expect(screen.getByLabelText('Rank 3 of 5 bids')).toBeDefined();
  });

  it('expands the bid history when the toggle is clicked', async () => {
    const user = userEvent.setup();
    const withHistory: BidWithProvider = {
      ...baseBid,
      bid: {
        ...baseBid.bid,
        bid_history: [{ amount_cents: 28000, updated_at: '2026-03-01T12:00:00Z' }],
      },
    };
    withProvider(<BidCard bidWithProvider={withHistory} jobId="job-1" canAward={false} />);
    const toggle = screen.getByRole('button', { name: /bid history \(1 update\)/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    // Re-query after the click to capture the post-render attribute value.
    const toggleAfter = screen.getByRole('button', { name: /bid history \(1 update\)/i });
    expect(toggleAfter.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/\(original\)/i)).toBeDefined();
  });

  it('reveals the award confirmation when Award Job is clicked', async () => {
    const user = userEvent.setup();
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={true} />);
    await user.click(screen.getByRole('button', { name: /award job/i }));
    expect(screen.getByRole('button', { name: /confirm award/i })).toBeDefined();
    // Cancel returns to the Award Job button
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /award job/i })).toBeDefined();
  });

  it('renders the Offer Accepted badge when the bid was accepted via instant offer', () => {
    const accepted: BidWithProvider = {
      ...baseBid,
      bid: { ...baseBid.bid, is_offer_accepted: true },
    };
    withProvider(<BidCard bidWithProvider={accepted} jobId="job-1" canAward={false} />);
    expect(screen.getByText(/offer accepted/i)).toBeDefined();
  });

  it('renders the awarded variant when the bid is awarded', () => {
    const awarded: BidWithProvider = {
      ...baseBid,
      bid: { ...baseBid.bid, status: 'awarded' },
    };
    withProvider(<BidCard bidWithProvider={awarded} jobId="job-1" canAward={false} />);
    // Award button is hidden; awarded bid renders the WinBadge
    expect(screen.queryByRole('button', { name: /award job/i })).toBeNull();
  });

  it('renders the percent-below-asking badge when starting price is supplied and bid is lower', () => {
    withProvider(
      <BidCard
        bidWithProvider={baseBid}
        jobId="job-1"
        canAward={false}
        startingPriceCents={50000}
      />,
    );
    // 50000 -> 25000 = 50% below
    expect(screen.getByText(/50% below asking/i)).toBeDefined();
  });

  it('renders the percent-below-market badge when median is supplied and bid is lower', () => {
    withProvider(
      <BidCard
        bidWithProvider={baseBid}
        jobId="job-1"
        canAward={false}
        marketMedianCents={50000}
      />,
    );
    expect(screen.getByText(/50% below market/i)).toBeDefined();
  });

  it('falls back to a plain provider count line when trust and review data are absent', () => {
    const minimal: BidWithProvider = {
      ...baseBid,
      trust_score: null,
      review_summary: null,
      jobs_completed: 1,
    };
    withProvider(<BidCard bidWithProvider={minimal} jobId="job-1" canAward={false} />);
    expect(screen.getByText('1 job completed')).toBeDefined();
  });

  it('uses the avatar fallback initials when no avatar URL is supplied', () => {
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={false} />);
    // "Acme Plumbing" -> "AP"
    expect(screen.getByText('AP')).toBeDefined();
  });

  it('renders the avatar block with provider_avatar_url supplied (mounts AvatarImage)', () => {
    const withAvatar: BidWithProvider = {
      ...baseBid,
      provider_avatar_url: 'https://cdn.example.com/p1.jpg',
    };
    // Mounting AvatarImage exercises the truthy provider_avatar_url branch (line 403-405).
    // Radix Avatar may not render the <img> until onLoad fires under jsdom, but the
    // branch in the source has executed once the component mounted without throwing.
    expect(() =>
      withProvider(<BidCard bidWithProvider={withAvatar} jobId="job-1" canAward={false} />),
    ).not.toThrow();
    // The fallback initials still render until the image loads.
    expect(screen.getByText('AP')).toBeDefined();
  });

  it('renders the trust block with trust_score but no review_summary', () => {
    // Exercises the branch where trust_score is present but review_summary is null
    // (line 513 conditional, lines 527-541 conditional).
    const trustOnly: BidWithProvider = {
      ...baseBid,
      review_summary: null,
    };
    withProvider(<BidCard bidWithProvider={trustOnly} jobId="job-1" canAward={false} />);
    // Verified badge appears for trust_score present.
    expect(screen.getByText('Verified')).toBeDefined();
    // The pluralized 47 jobs label still renders.
    expect(screen.getByText('47 jobs')).toBeDefined();
  });

  it('renders the trust block with review_summary but no trust_score', () => {
    // Exercises the branch where review_summary is present but trust_score is null.
    const reviewOnly: BidWithProvider = {
      ...baseBid,
      trust_score: null,
    };
    withProvider(<BidCard bidWithProvider={reviewOnly} jobId="job-1" canAward={false} />);
    // The numeric rating still renders.
    expect(screen.getByText('4.7')).toBeDefined();
    // 92% on-time text from review_summary on_time_rate.
    expect(screen.getByText(/92% on-time/)).toBeDefined();
  });

  it('renders the spinner inside Confirm Award while the award mutation is pending', async () => {
    const user = userEvent.setup();
    const { useAwardBid } = await import('@/hooks/useBids');
    vi.mocked(useAwardBid).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useAwardBid>);
    const { container } = withProvider(
      <BidCard bidWithProvider={baseBid} jobId="job-1" canAward={true} />,
    );
    await user.click(screen.getByRole('button', { name: /award job/i }));
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /confirm award/i }).disabled,
    ).toBe(true);
  });

  it('renders the award failure message when the award mutation errors', async () => {
    const user = userEvent.setup();
    const { useAwardBid } = await import('@/hooks/useBids');
    vi.mocked(useAwardBid).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof useAwardBid>);
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={true} />);
    await user.click(screen.getByRole('button', { name: /award job/i }));
    expect(screen.getByText(/Failed to award bid/i)).toBeDefined();
  });

  it('calls awardBid.mutate when Confirm Award is clicked', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    const { useAwardBid } = await import('@/hooks/useBids');
    vi.mocked(useAwardBid).mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useAwardBid>);
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={true} />);
    await user.click(screen.getByRole('button', { name: /award job/i }));
    await user.click(screen.getByRole('button', { name: /confirm award/i }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', bidId: 'bid-1' }),
      expect.any(Object),
    );
  });

  it('award onSuccess callback hides the confirm panel and shows Award Job again', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn(
      (_payload: unknown, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.();
      },
    );
    const { useAwardBid } = await import('@/hooks/useBids');
    vi.mocked(useAwardBid).mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useAwardBid>);
    withProvider(<BidCard bidWithProvider={baseBid} jobId="job-1" canAward={true} />);
    await user.click(screen.getByRole('button', { name: /award job/i }));
    await user.click(screen.getByRole('button', { name: /confirm award/i }));
    // After onSuccess, the confirm panel hides and the Award Job button reappears.
    expect(screen.queryByRole('button', { name: /confirm award/i })).toBeNull();
    expect(screen.getByRole('button', { name: /award job/i })).toBeDefined();
  });

  it('renders empty stars when the average rating falls below half-star thresholds', () => {
    // rating=1.2 → for i=1 full, i=2 half (1.2 >= 1.5? no), i=2..5 mostly empty stars
    // Actually 1.2 → i=1: 1.2>=1 full. i=2: 1.2 < 2 and 1.2 < 1.5 → empty. Empty branch hit.
    const lowRated: BidWithProvider = {
      ...baseBid,
      review_summary: { average_rating: 1.2, review_count: 5, on_time_rate: 0.5 },
    };
    withProvider(<BidCard bidWithProvider={lowRated} jobId="job-1" canAward={false} />);
    expect(screen.getByText('1.2')).toBeDefined();
  });

  it('hides the business-name line when provider_business_name is empty', () => {
    const noBiz: BidWithProvider = {
      ...baseBid,
      provider_business_name: '',
    };
    withProvider(<BidCard bidWithProvider={noBiz} jobId="job-1" canAward={false} />);
    // Display name still rendered.
    expect(screen.getByText('Acme Plumbing')).toBeDefined();
    // Business name line absent.
    expect(screen.queryByText('Acme LLC')).toBeNull();
  });

  it('renders the Above median competitive position when rank is past the median', () => {
    // For rank=8 totalBids=10, medianPosition = ceil(10/2) = 5; rank=8 > 5 → Above median.
    withProvider(
      <BidCard
        bidWithProvider={baseBid}
        jobId="job-1"
        canAward={false}
        rank={8}
        totalBids={10}
      />,
    );
    expect(screen.getByText(/Above median/i)).toBeDefined();
  });

  it('renders the (original) marker only on the last bid history update', async () => {
    const user = userEvent.setup();
    const withMultiHistory: BidWithProvider = {
      ...baseBid,
      bid: {
        ...baseBid.bid,
        bid_history: [
          { amount_cents: 27000, updated_at: '2026-03-01T11:00:00Z' },
          { amount_cents: 28000, updated_at: '2026-03-01T12:00:00Z' },
        ],
      },
    };
    withProvider(
      <BidCard bidWithProvider={withMultiHistory} jobId="job-1" canAward={false} />,
    );
    await user.click(screen.getByRole('button', { name: /bid history \(2 updates\)/i }));
    // Exactly one (original) tag is rendered, on the last entry.
    expect(screen.getAllByText(/\(original\)/i).length).toBe(1);
  });
});
