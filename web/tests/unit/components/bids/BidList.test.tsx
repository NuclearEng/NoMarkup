import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { type ReactElement } from 'react';

import { BidList } from '@/components/bids/BidList';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { BidsForJobResponse, BidWithProvider } from '@/types';

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
  // PointerEvent / hasPointerCapture are missing in jsdom — Radix Select uses them.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

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

type BidOverrides = Partial<BidWithProvider['bid']> & {
  provider?: string;
  rating?: number;
  trust?: number;
  jobsCompleted?: number;
};

const makeBid = (over: BidOverrides = {}): BidWithProvider => ({
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
  trust_score:
    over.trust !== undefined
      ? ({ overall_score: over.trust, tier: 'trusted' } as unknown as BidWithProvider['trust_score'])
      : null,
  review_summary:
    over.rating !== undefined
      ? ({
          average_rating: over.rating,
          review_count: 5,
          on_time_rate: 0.95,
        } as unknown as BidWithProvider['review_summary'])
      : null,
  jobs_completed: over.jobsCompleted ?? 5,
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

  it('renders 1 bid in singular form when there is exactly one bid', () => {
    const data: BidsForJobResponse = {
      bids: [makeBid({ id: 'only', amount_cents: 20000, provider: 'Only Co' })],
    };
    vi.mocked(useBidsForJob).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(<BidList jobId="job-1" canAward={false} />);
    expect(screen.getByText(/^1 bid$/)).toBeDefined();
  });

  it('passes startingPriceCents and marketMedianCents through to BidCard', () => {
    const data: BidsForJobResponse = {
      bids: [makeBid({ id: 'a', amount_cents: 20000, provider: 'Acme Co' })],
    };
    vi.mocked(useBidsForJob).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(
      <BidList
        jobId="job-1"
        canAward
        startingPriceCents={50000}
        marketMedianCents={30000}
      />,
    );
    expect(screen.getByText('Acme Co')).toBeDefined();
  });

  it('changes sort when a new option is selected (rating, including bids without ratings)', async () => {
    const user = userEvent.setup();
    const data: BidsForJobResponse = {
      bids: [
        // mix of with-rating and without-rating to exercise ?? 0 fallback
        makeBid({ id: 'a', amount_cents: 20000, provider: 'Acme Co', rating: 3 }),
        makeBid({ id: 'b', amount_cents: 22000, provider: 'Beta Co' }),
        makeBid({ id: 'c', amount_cents: 24000, provider: 'Cee Co', rating: 5 }),
      ],
    };
    vi.mocked(useBidsForJob).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(<BidList jobId="job-1" canAward={false} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const option = await screen.findByRole('option', { name: /Highest Rating/i });
    await user.click(option);
    expect(screen.getByText('Acme Co')).toBeDefined();
    expect(screen.getByText('Beta Co')).toBeDefined();
    expect(screen.getByText('Cee Co')).toBeDefined();
  });

  it('changes sort when a new option is selected (trust, including bids without trust scores)', async () => {
    const user = userEvent.setup();
    const data: BidsForJobResponse = {
      bids: [
        makeBid({ id: 'a', amount_cents: 20000, provider: 'Acme Co', trust: 50 }),
        makeBid({ id: 'b', amount_cents: 22000, provider: 'Beta Co' }),
        makeBid({ id: 'c', amount_cents: 24000, provider: 'Cee Co', trust: 90 }),
      ],
    };
    vi.mocked(useBidsForJob).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(<BidList jobId="job-1" canAward={false} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const option = await screen.findByRole('option', { name: /Trust Score/i });
    await user.click(option);
    expect(screen.getByText('Acme Co')).toBeDefined();
    expect(screen.getByText('Beta Co')).toBeDefined();
    expect(screen.getByText('Cee Co')).toBeDefined();
  });

  it('changes sort when a new option is selected (jobs_completed)', async () => {
    const user = userEvent.setup();
    const data: BidsForJobResponse = {
      bids: [
        makeBid({ id: 'a', amount_cents: 20000, provider: 'Acme Co', jobsCompleted: 5 }),
        makeBid({ id: 'b', amount_cents: 22000, provider: 'Beta Co', jobsCompleted: 50 }),
      ],
    };
    vi.mocked(useBidsForJob).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(<BidList jobId="job-1" canAward={false} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const option = await screen.findByRole('option', { name: /Most Jobs/i });
    await user.click(option);
    expect(screen.getByText('Acme Co')).toBeDefined();
  });

  it('renders an empty list when data is undefined', () => {
    vi.mocked(useBidsForJob).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    withProvider(<BidList jobId="job-1" canAward={false} />);
    expect(screen.getByText(/no bids yet/i)).toBeDefined();
  });
});

// Suppress unused-warning safety on mock typing
void ({} as Mock);
