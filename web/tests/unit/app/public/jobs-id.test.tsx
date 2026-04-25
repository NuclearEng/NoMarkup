// Job detail page (`/jobs/[id]`) — heavy client component with auctions,
// terminal layout, etc. We mock the auction-related child components and the
// data hooks; the page renders different layouts based on auction_type +
// status, so we test the simpler "sealed bid / standard" path.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs/test-id',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'test-id' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

// Stub heavy child components — they have their own tests and pull deep deps.
const stubModule = (testid: string) => () =>
  createElement('div', { 'data-testid': testid });

vi.mock('@/components/bids/BidActivityFeed', () => ({ BidActivityFeed: stubModule('bid-activity') }));
vi.mock('@/components/bids/BidForm', () => ({ BidForm: stubModule('bid-form') }));
vi.mock('@/components/bids/BidList', () => ({ BidList: stubModule('bid-list') }));
vi.mock('@/components/bids/BidPlacementPanel', () => ({ BidPlacementPanel: stubModule('bid-placement') }));
vi.mock('@/components/bids/BidPriceChart', () => ({ BidPriceChart: stubModule('bid-price-chart') }));
vi.mock('@/components/bids/LiveBidTicker', () => ({ LiveBidTicker: stubModule('live-bid-ticker') }));
vi.mock('@/components/landing/GradientMesh', () => ({ GradientMesh: stubModule('mesh') }));
vi.mock('@/components/jobs/AuctionTimer', () => ({ AuctionTimer: stubModule('auction-timer') }));
vi.mock('@/components/jobs/BidPushPrompt', () => ({ BidPushPrompt: stubModule('push-prompt') }));
vi.mock('@/components/jobs/MarketRangeDisplay', () => ({ MarketRangeDisplay: stubModule('market-range') }));
vi.mock('@/components/jobs/PermitIntelligenceBanner', () => ({ PermitIntelligenceBanner: stubModule('permit') }));
vi.mock('@/components/jobs/SavingsBadge', () => ({ SavingsBadge: stubModule('savings-badge') }));
vi.mock('@/components/jobs/ViewerCount', () => ({ ViewerCount: stubModule('viewer-count') }));
vi.mock('@/components/terminal/terminal-toolbar', () => ({ TerminalToolbar: stubModule('terminal-toolbar') }));
vi.mock('@/components/terminal/terminal-grid', () => ({ TerminalGrid: stubModule('terminal-grid') }));

vi.mock('@/lib/constants', () => ({ ENABLE_LIVE_AUCTION: false }));

vi.mock('@/hooks/useAuctionTerminal', () => ({
  useAuctionTerminal: () => ({ sim: {}, providers: [], isConnected: false, error: null }),
}));
vi.mock('@/hooks/useBids', () => ({
  useBidCount: () => ({ data: 0 }),
  useBidsForJob: () => ({ data: { bids: [] } }),
  usePlaceBid: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: () => ({ timeLeft: '1h', isExpired: false }),
}));
vi.mock('@/hooks/useJobs', () => ({
  useJob: vi.fn(),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: null; isAuthenticated: boolean }) => unknown) =>
    selector({ user: null, isAuthenticated: false }),
}));

const { useJob } = await import('@/hooks/useJobs');
const { default: JobDetailPage } = await import('@/app/(public)/jobs/[id]/page');

describe('(public)/jobs/[id]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the loading skeleton', () => {
    vi.mocked(useJob).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useJob>);

    const { container } = render(createElement(JobDetailPage));
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the not-found state when the job fails to load', () => {
    vi.mocked(useJob).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useJob>);

    render(createElement(JobDetailPage));
    expect(screen.getByText('Job not found')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });

  it('renders the standard sealed-bid layout when a job is loaded', () => {
    vi.mocked(useJob).mockReturnValue({
      data: {
        id: 'test-id',
        customer_id: 'cust-1',
        title: 'Replace water heater',
        description: 'Need a new tankless unit',
        status: 'active',
        auction_type: 'sealed',
        category_name: 'Plumbing',
        category_slug: 'plumbing',
        auction_duration_hours: 24,
        bid_count: 0,
        schedule_type: 'flexible',
        scheduled_date: null,
        is_recurring: false,
        recurrence_frequency: null,
        location_address: null,
        location_lat: null,
        location_lng: null,
        starting_bid_cents: null,
        offer_accepted_cents: null,
        lowest_bid_cents: null,
        market_range: null,
        auction_ends_at: null,
        created_at: '2026-04-01T00:00:00Z',
        customer_display_name: 'Sam Customer',
        customer_member_since: '2024-01-01T00:00:00Z',
        customer_jobs_posted: 1,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useJob>);

    render(createElement(JobDetailPage));
    expect(screen.getByRole('heading', { name: 'Replace water heater' })).toBeDefined();
    expect(screen.getByText('Description')).toBeDefined();
    expect(screen.getByText('Posted By')).toBeDefined();
  });
});
