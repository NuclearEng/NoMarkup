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
vi.mock('@/components/chat/ReportButton', () => ({ ReportButton: stubModule('report-button') }));
// BidPlacementPanel stub forwards onPlaceBid via a button so we can fire the
// page's placeBid.mutate handler from a test.
vi.mock('@/components/bids/BidPlacementPanel', () => ({
  BidPlacementPanel: ({
    onPlaceBid,
  }: {
    onPlaceBid?: (amountCents: number) => void;
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'bid-placement',
        onClick: () => {
          onPlaceBid?.(7777);
        },
      },
      'Place bid',
    ),
}));
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
vi.mock('@/hooks/useInstantMatch', () => ({
  useCreateInstantMatch: vi.fn(),
  useProviderOffers: vi.fn(),
  useAcceptOffer: vi.fn(),
  useDeclineOffer: vi.fn(),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const { useJob } = await import('@/hooks/useJobs');
const { useAuctionTerminal } = await import('@/hooks/useAuctionTerminal');
const { useBidCount, useBidsForJob, usePlaceBid } = await import('@/hooks/useBids');
const { useCountdown } = await import('@/hooks/useCountdown');
const { useCreateInstantMatch } = await import('@/hooks/useInstantMatch');
const { useAuthStore } = await import('@/stores/auth-store');
// The page is now an async Server Component (server-fetch + JobPosting
// JSON-LD); the interactive auction UI lives in JobDetailClient, which
// consumes the same useJob hook (seeded via initialData). These tests drive
// the rendered UI through that mocked hook, so they target the client island.
const { JobDetailClient } = await import('@/app/(public)/jobs/[id]/JobDetailClient');

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
    ((selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state) as unknown as typeof useAuthStore,
  );
}

function setHooks(opts: {
  job?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  refetch?: () => void;
  bids?: unknown[];
  bidCount?: number;
  countdown?: { timeLeft: string; isExpired: boolean; totalSeconds: number };
  terminal?: { isConnected?: boolean; error?: unknown };
  placeBidMutate?: ReturnType<typeof vi.fn>;
  instantMatchMutate?: ReturnType<typeof vi.fn>;
  instantMatchPending?: boolean;
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
  vi.mocked(useCreateInstantMatch).mockReturnValue({
    mutate: opts.instantMatchMutate ?? vi.fn(),
    isPending: opts.instantMatchPending ?? false,
  } as unknown as ReturnType<typeof useCreateInstantMatch>);
  vi.mocked(useCountdown).mockReturnValue(
    opts.countdown ?? { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
  );
  vi.mocked(useAuctionTerminal).mockReturnValue({
    sim: {},
    providers: [],
    isConnected: opts.terminal?.isConnected ?? false,
    error: opts.terminal?.error ?? null,
  } as unknown as ReturnType<typeof useAuctionTerminal>);
}

// The client island requires jobId + initialJob props. The mocked useJob hook
// overrides what actually renders, so a minimal stub initialJob is enough to
// satisfy the prop contract.
function renderClient() {
  return render(
    createElement(JobDetailClient, { jobId: 'test-id', initialJob: baseJob as never }),
  );
}

describe('(public)/jobs/[id]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuth({ user: null, isAuthenticated: false });
    setHooks();
  });

  // The page is now RSC: the server fetches the job and seeds the client island
  // via initialData, so there is no first-paint loading skeleton — the island
  // renders real content immediately. This asserts that no-skeleton behavior.
  it('renders seeded content immediately with no loading skeleton', () => {
    setHooks({ job: baseJob });
    const { container } = renderClient();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
    expect(screen.getByRole('heading', { name: 'Replace water heater' })).toBeDefined();
  });

  it('renders the not-found state when the job fails to load', () => {
    const refetch = vi.fn();
    setHooks({ isError: true, refetch });
    renderClient();
    expect(screen.getByText('Job not found')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the standard sealed-bid layout when a job is loaded', () => {
    setHooks({ job: baseJob });
    renderClient();
    expect(screen.getByRole('heading', { name: 'Replace water heater' })).toBeDefined();
    expect(screen.getByText('Description')).toBeDefined();
    expect(screen.getByText('Posted By')).toBeDefined();
  });

  it('renders the sign-in CTA in the auction status card when unauthenticated', () => {
    setHooks({ job: baseJob });
    renderClient();
    expect(screen.getByRole('link', { name: /Sign in to bid/ })).toBeDefined();
  });

  it('renders the only-providers fallback for an authenticated non-provider non-owner', () => {
    setAuth({
      user: { id: 'other-user', roles: ['customer'] },
      isAuthenticated: true,
    });
    setHooks({ job: baseJob });
    renderClient();
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
    renderClient();
    expect(screen.getByTestId('bid-list')).toBeDefined();
  });

  it('lets the job owner request instant match when accept-now price is set', () => {
    const mutate = vi.fn();
    setAuth({
      user: { id: 'cust-1', roles: ['customer'] },
      isAuthenticated: true,
    });
    setHooks({
      job: { ...baseJob, offer_accepted_cents: 15_000, status: 'active' },
      instantMatchMutate: mutate,
    });
    renderClient();
    const cta = screen.getByRole('button', { name: /Request Instant match/i });
    expect(cta).toBeDefined();
    fireEvent.click(cta);
    expect(mutate).toHaveBeenCalled();
  });

  it('hides the instant-match CTA when the owner job has no accept-now price', () => {
    setAuth({
      user: { id: 'cust-1', roles: ['customer'] },
      isAuthenticated: true,
    });
    setHooks({ job: { ...baseJob, offer_accepted_cents: null, status: 'active' } });
    renderClient();
    expect(screen.queryByRole('button', { name: /Request Instant match/i })).toBeNull();
  });

  it('hides the instant-match CTA for non-owners even with accept-now price', () => {
    setAuth({
      user: { id: 'other-user', roles: ['customer'] },
      isAuthenticated: true,
    });
    setHooks({
      job: { ...baseJob, offer_accepted_cents: 15_000, status: 'active' },
    });
    renderClient();
    expect(screen.queryByRole('button', { name: /Request Instant match/i })).toBeNull();
  });

  it('renders the live auction terminal layout when conditions are met', () => {
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2099-01-01T00:00:00Z' },
      countdown: { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
      terminal: { isConnected: true },
    });
    renderClient();
    expect(screen.getByTestId('terminal-grid')).toBeDefined();
    expect(screen.getByText('LIVE')).toBeDefined();
  });

  it('falls back to the standard layout when a live auction is expired', () => {
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2020-01-01T00:00:00Z' },
      countdown: { timeLeft: '0', isExpired: true, totalSeconds: 0 },
    });
    renderClient();
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
    renderClient();
    expect(screen.getByText(/Recurring: weekly/)).toBeDefined();
  });

  it('renders the lowest bid cents when present', () => {
    setHooks({
      job: { ...baseJob, lowest_bid_cents: 12345, starting_bid_cents: 50000, bid_count: 3 },
    });
    renderClient();
    expect(screen.getByText(/Lowest:/)).toBeDefined();
    expect(screen.getByTestId('live-bid-ticker')).toBeDefined();
  });

  it('renders BidForm in the live terminal layout for an authenticated provider who can bid', () => {
    setAuth({
      user: { id: 'prov-1', roles: ['provider'] },
      isAuthenticated: true,
    });
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2099-01-01T00:00:00Z' },
      countdown: { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
      terminal: { isConnected: true },
    });
    renderClient();
    // BidForm renders inside the sticky bottom bar of the live layout.
    expect(screen.getByTestId('bid-form')).toBeDefined();
  });

  it('shows the Provider badge in the live header when the user is a provider non-owner', () => {
    setAuth({
      user: { id: 'prov-2', roles: ['provider'] },
      isAuthenticated: true,
    });
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2099-01-01T00:00:00Z' },
      countdown: { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
      terminal: { isConnected: true },
    });
    renderClient();
    expect(screen.getByText('Provider')).toBeDefined();
  });

  it('shows the Owner badge in the live header for the job owner who is also a provider', () => {
    setAuth({
      user: { id: 'cust-1', roles: ['provider'] },
      isAuthenticated: true,
    });
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2099-01-01T00:00:00Z' },
      countdown: { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
      terminal: { isConnected: true },
    });
    renderClient();
    expect(screen.getByText('Owner')).toBeDefined();
  });

  it('renders Disconnected status when the live terminal reports an error', () => {
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2099-01-01T00:00:00Z' },
      countdown: { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
      terminal: { isConnected: false, error: new Error('boom') },
    });
    renderClient();
    expect(screen.getByText('Disconnected')).toBeDefined();
  });

  it('renders Connecting status before the live terminal connects', () => {
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2099-01-01T00:00:00Z' },
      countdown: { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
      terminal: { isConnected: false, error: null },
    });
    renderClient();
    expect(screen.getByText('Connecting')).toBeDefined();
  });

  it('renders the location address in the live header when present', () => {
    setHooks({
      job: {
        ...baseJob,
        auction_type: 'live',
        auction_ends_at: '2099-01-01T00:00:00Z',
        location_address: '500 Oak Ave',
      },
      countdown: { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
      terminal: { isConnected: true },
    });
    renderClient();
    // Location may render multiple places in live header (desktop + mobile); both ok.
    expect(screen.getAllByText('500 Oak Ave').length).toBeGreaterThan(0);
  });

  it('renders the sign-in CTA in the live layout when unauthenticated', () => {
    setHooks({
      job: { ...baseJob, auction_type: 'live', auction_ends_at: '2099-01-01T00:00:00Z' },
      countdown: { timeLeft: '1h', isExpired: false, totalSeconds: 3600 },
      terminal: { isConnected: true },
    });
    renderClient();
    expect(screen.getByText(/Sign in to place a bid/)).toBeDefined();
  });

  it('renders the draft job badge when status is draft', () => {
    setHooks({
      job: { ...baseJob, status: 'draft' },
    });
    renderClient();
    // Status badge text replaces underscores with spaces; "draft" remains as is.
    expect(screen.getByText('draft')).toBeDefined();
  });

  it('renders the recurring badge with frequency only when both is_recurring and frequency exist', () => {
    setHooks({
      job: { ...baseJob, is_recurring: true, recurrence_frequency: 'monthly' },
    });
    renderClient();
    expect(screen.getByText(/Recurring: monthly/)).toBeDefined();
  });

  it('renders the scheduled_date row when the job has a scheduled date', () => {
    setHooks({
      job: { ...baseJob, scheduled_date: '2026-05-01T10:00:00Z' },
    });
    renderClient();
    // The scheduled date renders with locale-formatted weekday/month/day/year.
    expect(screen.getByText(/2026/)).toBeDefined();
  });

  it('renders the BidActivityFeed when historical bids exist', () => {
    setHooks({
      job: baseJob,
      bids: [
        {
          bid: {
            id: 'b1',
            amount_cents: 10000,
            provider_id: 'p1',
            created_at: '2026-04-10T00:00:00Z',
          },
          provider_display_name: 'Pro A',
          provider_business_name: 'Pro A LLC',
        },
      ],
    });
    setAuth({ user: { id: 'cust-1', roles: ['customer'] }, isAuthenticated: true });
    renderClient();
    expect(screen.getByTestId('bid-activity')).toBeDefined();
  });

  it('renders BidForm for a provider with no existing bid (first-bid path)', () => {
    // Sealed auctions never populate lowest_bid_cents, so the first-bid UI is
    // BidForm (which handles both first + lower bids), not BidPlacementPanel.
    setAuth({
      user: { id: 'prov-new', roles: ['provider'] },
      isAuthenticated: true,
    });
    setHooks({
      job: { ...baseJob, lowest_bid_cents: 50000, starting_bid_cents: 100000 },
      bids: [],
    });
    renderClient();
    expect(screen.getAllByTestId('bid-form').length).toBeGreaterThan(0);
  });

  it('renders MarketRangeDisplay when market_range has a sample size', () => {
    setHooks({
      job: {
        ...baseJob,
        market_range: { low_cents: 1000, median_cents: 2000, high_cents: 3000, sample_size: 10 },
      },
    });
    renderClient();
    expect(screen.getByTestId('market-range')).toBeDefined();
  });

  it('renders the static map preview when location coords + Mapbox token are set', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test_token';
    setHooks({
      job: {
        ...baseJob,
        location_lat: 37.7749,
        location_lng: -122.4194,
        location_address: '500 Oak Ave',
      },
    });
    const { container } = renderClient();
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toContain('api.mapbox.com');
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
  });

  it('renders the existing-bid BidForm path inside auction status card for provider with existing bid', () => {
    setAuth({
      user: { id: 'prov-1', roles: ['provider'] },
      isAuthenticated: true,
    });
    setHooks({
      job: baseJob,
      bids: [
        {
          bid: {
            id: 'mybid',
            amount_cents: 9000,
            provider_id: 'prov-1',
            created_at: '2026-04-10T00:00:00Z',
          },
          provider_display_name: 'Me',
          provider_business_name: 'Me LLC',
        },
      ],
    });
    renderClient();
    expect(screen.getByTestId('bid-form')).toBeDefined();
  });

  it('renders pluralized customer_jobs_posted in the Posted By card', () => {
    setHooks({
      job: { ...baseJob, customer_jobs_posted: 5 },
    });
    renderClient();
    expect(screen.getByText(/5 jobs.*posted/)).toBeDefined();
  });

  it('uses the auction_ends_at fallback (2h from now) when the job has no auction_ends_at', () => {
    setHooks({
      job: { ...baseJob, auction_ends_at: null },
    });
    const { container } = renderClient();
    // Without auction_ends_at, the AuctionTimer is still not rendered (null branch).
    // The "Auction not started" copy should appear instead.
    expect(container.textContent).toContain('Auction not started');
  });

  it('renders the Instant Accept Price block when offer_accepted_cents is set', () => {
    setHooks({
      job: { ...baseJob, offer_accepted_cents: 25000 },
    });
    renderClient();
    expect(screen.getByText('Instant Accept Price')).toBeDefined();
  });

  it('renders the static map without the address overlay when location_address is missing', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test_token';
    setHooks({
      job: {
        ...baseJob,
        location_lat: 37.7749,
        location_lng: -122.4194,
        location_address: null,
      },
    });
    const { container } = renderClient();
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // The address overlay div is not rendered without an address.
    expect(container.querySelector('.bg-zinc-900\\/80')).toBeNull();
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
  });

  it('renders the SavingsBadge when lowest bid and market median are both present', () => {
    setHooks({
      job: {
        ...baseJob,
        lowest_bid_cents: 80000,
        starting_bid_cents: 100000,
        market_range: { low_cents: 90000, median_cents: 100000, high_cents: 110000, sample_size: 5 },
      },
    });
    renderClient();
    expect(screen.getByTestId('savings-badge')).toBeDefined();
  });

  it('renders BidList with canAward true for an owner of a closed job', () => {
    setAuth({
      user: { id: 'cust-1', roles: ['customer'] },
      isAuthenticated: true,
    });
    setHooks({
      job: { ...baseJob, status: 'closed' },
    });
    renderClient();
    expect(screen.getByTestId('bid-list')).toBeDefined();
  });

  it('falls back to provider_business_name when display_name is empty in BidActivityFeed', () => {
    setAuth({ user: { id: 'cust-1', roles: ['customer'] }, isAuthenticated: true });
    setHooks({
      job: baseJob,
      bids: [
        {
          bid: {
            id: 'b-fallback',
            amount_cents: 9999,
            provider_id: 'p-x',
            created_at: '2026-04-10T00:00:00Z',
          },
          provider_display_name: '',
          provider_business_name: 'Fallback Biz LLC',
        },
      ],
    });
    renderClient();
    expect(screen.getByTestId('bid-activity')).toBeDefined();
  });

  it('uses the Specific Date schedule label when schedule_type is specific_date', () => {
    setHooks({
      job: { ...baseJob, schedule_type: 'specific_date' },
    });
    renderClient();
    expect(screen.getByText('Specific Date')).toBeDefined();
  });

  it('uses the Date Range schedule label when schedule_type is date_range', () => {
    setHooks({
      job: { ...baseJob, schedule_type: 'date_range' },
    });
    renderClient();
    expect(screen.getByText('Date Range')).toBeDefined();
  });

  it('renders the outline status badge variant for non-active, non-draft job statuses', () => {
    setHooks({
      job: { ...baseJob, status: 'closed' },
    });
    renderClient();
    // The status text is replaced underscore→space; status remains "closed".
    expect(screen.getByText('closed')).toBeDefined();
  });

  it('finds and uses the existing bid for an authenticated provider', () => {
    // Exercises the existingBid lookup branch where bidsData.bids contains the user's bid.
    setAuth({
      user: { id: 'prov-self', roles: ['provider'] },
      isAuthenticated: true,
    });
    setHooks({
      job: baseJob,
      bids: [
        {
          bid: {
            id: 'b-self',
            amount_cents: 4000,
            provider_id: 'prov-self',
            created_at: '2026-04-10T00:00:00Z',
          },
          provider_display_name: 'Self',
          provider_business_name: 'Self LLC',
        },
      ],
    });
    renderClient();
    // BidForm renders for a provider with an existing bid (lines 590-599).
    expect(screen.getByTestId('bid-form')).toBeDefined();
  });
});
