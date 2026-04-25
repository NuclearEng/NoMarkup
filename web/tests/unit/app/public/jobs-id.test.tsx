// Job detail page (`/jobs/[id]`) — heavy client component with auctions,
// terminal layout, etc. We mock the auction-related child components and the
// data hooks; the page renders different layouts based on auction_type +
// status, so we test the simpler "sealed bid / standard" path plus the live
// terminal layout and a few key branches.
import { fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('@/lib/constants', () => ({ ENABLE_LIVE_AUCTION: true }));

vi.mock('@/hooks/useAuctionTerminal', () => ({
  useAuctionTerminal: vi.fn(),
}));
vi.mock('@/hooks/useBids', () => ({
  useBidCount: vi.fn(),
  useBidsForJob: vi.fn(),
  usePlaceBid: vi.fn(),
}));
vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: vi.fn(),
}));
vi.mock('@/hooks/useJobs', () => ({
  useJob: vi.fn(),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const { useJob } = await import('@/hooks/useJobs');
const { useAuctionTerminal } = await import('@/hooks/useAuctionTerminal');
const { useBidCount, useBidsForJob, usePlaceBid } = await import('@/hooks/useBids');
const { useCountdown } = await import('@/hooks/useCountdown');
const { useAuthStore } = await import('@/stores/auth-store');
const { default: JobDetailPage } = await import('@/app/(public)/jobs/[id]/page');

const baseJob = {
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
};

function setAuth(state: { user: unknown; isAuthenticated: boolean }) {
  vi.mocked(useAuthStore).mockImplementation(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) as never,
  );
}

function setHooks(opts: {
  job?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  refetch?: () => void;
  bids?: unknown[];
  bidCount?: number;
  countdown?: { timeLeft: string; isExpired: boolean };
  terminal?: { isConnected?: boolean; error?: unknown };
  placeBidMutate?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(useJob).mockReturnValue({
    data: opts.job,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    refetch: opts.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useJob>);
  vi.mocked(useBidCount).mockReturnValue({ data: opts.bidCount } as ReturnType<typeof useBidCount>);
  vi.mocked(useBidsForJob).mockReturnValue({
    data: { bids: opts.bids ?? [] },
  } as unknown as ReturnType<typeof useBidsForJob>);
  vi.mocked(usePlaceBid).mockReturnValue({
    mutate: opts.placeBidMutate ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof usePlaceBid>);
  vi.mocked(useCountdown).mockReturnValue(
    opts.countdown ?? { timeLeft: '1h', isExpired: false },
  );
  vi.mocked(useAuctionTerminal).mockReturnValue({
    sim: {},
    providers: [],
    isConnected: opts.terminal?.isConnected ?? false,
    error: opts.terminal?.error ?? null,
  } as unknown as ReturnType<typeof useAuctionTerminal>);
}

describe('(public)/jobs/[id]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuth({ user: null, isAuthenticated: false });
    setHooks();
  });

  it('renders the loading skeleton', () => {
    setHooks({ isLoading: true });
    const { container } = render(createElement(JobDetailPage));
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the not-found state when the job fails to load', () => {
    const refetch = vi.fn();
    setHooks({ isError: true, refetch });
    render(createElement(JobDetailPage));
    expect(screen.getByText('Job not found')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the standard sealed-bid layout when a job is loaded', () => {
    setHooks({ job: baseJob });
    render(createElement(JobDetailPage));
    expect(screen.getByRole('heading', { name: 'Replace water heater' })).toBeDefined();
    expect(screen.getByText('Description')).toBeDefined();
    expect(screen.getByText('Posted By')).toBeDefined();
  });

  it('renders the sign-in CTA in the auction status card when unauthenticated', () => {
    setHooks({ job: baseJob });
    render(createElement(JobDetailPage));
    expect(screen.getByRole('link', { name: /Sign in to bid/ })).toBeDefined();
  });

  it('renders the only-providers fallback for an authenticated non-provider non-owner', () => {
    setAuth({
      user: { id: 'other-user', roles: ['customer'] },
      isAuthenticated: true,
    });
    setHooks({ job: baseJob });
    render(createElement(JobDetailPage));
    expect(
      screen.getByText('Only providers can place bids on jobs.'),
    ).toBeDefined();
  });

  it('renders the BidList for the job owner', () => {
    setAuth({
      user: { id: 'cust-1', roles: ['customer'] },
      isAuthenticated: true,
    });
    setHooks({ job: baseJob });
    render(createElement(JobDetailPage));
    expect(screen.getByTestId('bid-list')).toBeDefined();
  });

  it('renders the live auction terminal layout when conditions are met', () => {
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2099-01-01T00:00:00Z' },
      countdown: { timeLeft: '1h', isExpired: false },
      terminal: { isConnected: true },
    });
    render(createElement(JobDetailPage));
    expect(screen.getByTestId('terminal-grid')).toBeDefined();
    expect(screen.getByText('LIVE')).toBeDefined();
  });

  it('falls back to the standard layout when a live auction is expired', () => {
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2020-01-01T00:00:00Z' },
      countdown: { timeLeft: '0', isExpired: true },
    });
    render(createElement(JobDetailPage));
    // No terminal grid — standard layout shows the customer card.
    expect(screen.queryByTestId('terminal-grid')).toBeNull();
    expect(screen.getByText('Posted By')).toBeDefined();
  });

  it('renders the recurring badge when the job is recurring', () => {
    setHooks({
      job: {
        ...baseJob,
        is_recurring: true,
        recurrence_frequency: 'weekly',
        scheduled_date: null,
      },
    });
    render(createElement(JobDetailPage));
    expect(screen.getByText(/Recurring: weekly/)).toBeDefined();
  });

  it('renders the lowest bid cents when present', () => {
    setHooks({
      job: { ...baseJob, lowest_bid_cents: 12345, starting_bid_cents: 50000, bid_count: 3 },
    });
    render(createElement(JobDetailPage));
    expect(screen.getByText(/Lowest:/)).toBeDefined();
    expect(screen.getByTestId('live-bid-ticker')).toBeDefined();
  });
});
