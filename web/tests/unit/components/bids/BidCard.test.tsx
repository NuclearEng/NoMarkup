import { render, screen } from '@testing-library/react';
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
});
