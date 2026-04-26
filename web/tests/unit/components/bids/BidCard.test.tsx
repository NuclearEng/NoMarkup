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
});
