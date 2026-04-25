import { render, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BidList } from '@/components/bids/BidList';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { BidsForJobResponse, BidWithProvider } from '@/types';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), getPublic: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/hooks/useBids', () => ({
  useBidsForJob: vi.fn(),
  useAwardBid: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
}));

const { useBidsForJob } = await import('@/hooks/useBids');

function withProvider(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const makeBid = (over: Partial<BidWithProvider['bid']> & { provider?: string } = {}): BidWithProvider => ({
  bid: {
    id: over.id ?? 'bid-1',
    job_id: 'job-1',
    provider_id: 'p1',
    amount_cents: over.amount_cents ?? 20000,
    is_offer_accepted: false,
    status: 'active',
    original_amount_cents: 25000,
    bid_history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    awarded_at: null,
    withdrawn_at: null,
  },
  provider_display_name: over.provider ?? 'Provider 1',
  provider_business_name: '',
  provider_avatar_url: null,
  trust_score: null,
  review_summary: null,
  jobs_completed: 5,
});

describe('BidList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders skeletons while loading', () => {
    vi.mocked(useBidsForJob).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    const { container } = withProvider(<BidList jobId="job-1" canAward={false} />);
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
  });

  it('renders an error banner when the query errors', () => {
    vi.mocked(useBidsForJob).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(<BidList jobId="job-1" canAward={false} />);
    expect(screen.getByText(/failed to load bids/i)).toBeDefined();
  });

  it('renders empty state when there are no bids', () => {
    const data: BidsForJobResponse = { bids: [] };
    vi.mocked(useBidsForJob).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(<BidList jobId="job-1" canAward={false} />);
    expect(screen.getByText(/no bids yet/i)).toBeDefined();
  });

  it('renders a row per bid and a count', () => {
    const data: BidsForJobResponse = {
      bids: [
        makeBid({ id: 'a', amount_cents: 20000, provider: 'Acme Co' }),
        makeBid({ id: 'b', amount_cents: 22000, provider: 'Beta Co' }),
        makeBid({ id: 'c', amount_cents: 24000, provider: 'Cee Co' }),
      ],
    };
    vi.mocked(useBidsForJob).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(<BidList jobId="job-1" canAward={false} />);
    expect(screen.getByText('3 bids')).toBeDefined();
    expect(screen.getByText('Acme Co')).toBeDefined();
    expect(screen.getByText('Beta Co')).toBeDefined();
    expect(screen.getByText('Cee Co')).toBeDefined();
  });

  it('renders the sort selector', () => {
    const data: BidsForJobResponse = {
      bids: [makeBid({ id: 'a', amount_cents: 20000, provider: 'Only Co' })],
    };
    vi.mocked(useBidsForJob).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(<BidList jobId="job-1" canAward={false} />);
    expect(screen.getByRole('combobox')).toBeDefined();
  });
});
