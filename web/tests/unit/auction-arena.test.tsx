import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuctionArena } from '@/components/bids/AuctionArena';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { BidWithProvider, JobDetail } from '@/types';

// jsdom does not include ResizeObserver — provide a minimal stub
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

// Mock hooks
vi.mock('@/hooks/useAuctionStream', () => ({
  useAuctionStream: vi.fn(() => ({
    events: [],
    connectionStatus: 'disconnected',
    currentLowest: 0,
    bidCount: 0,
    auctionEndsAt: null,
    snipeExtensionCount: 0,
    isConnected: false,
  })),
}));

vi.mock('@/hooks/useBids', () => ({
  useLiveAuctionState: vi.fn(() => ({ data: null, isLoading: false })),
  useBidsForJob: vi.fn(() => ({ data: null, isLoading: false })),
}));

vi.mock('@/lib/constants', () => ({
  ENABLE_LIVE_AUCTION: true,
}));

// Mock BidForm to avoid pulling in its dependencies
vi.mock('@/components/bids/BidForm', () => ({
  BidForm: () => createElement('div', { 'data-testid': 'bid-form' }, 'Place Your Bid'),
}));

const { useAuctionStream } = await import('@/hooks/useAuctionStream');
const { useLiveAuctionState, useBidsForJob } = await import('@/hooks/useBids');

const defaultStreamReturn = {
  events: [] as [],
  connectionStatus: 'disconnected' as const,
  currentLowest: 0,
  bidCount: 0,
  auctionEndsAt: null,
  snipeExtensionCount: 0,
  isConnected: false,
  orderBook: [] as [],
  priceHistory: [] as [],
  velocity: 0,
  momentum: 'stable' as const,
  velocityBuckets: [] as number[],
};

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(TooltipProvider, null, children),
    );
  };
}

const mockJobDetail: JobDetail = {
  id: 'job-1',
  customer_id: 'cust-1',
  category_id: 'cat-1',
  category_name: 'Plumbing',
  category_slug: 'plumbing',
  title: 'Fix kitchen sink',
  description: 'A'.repeat(50),
  status: 'active',
  schedule_type: 'flexible',
  scheduled_date: null,
  is_recurring: false,
  recurrence_frequency: null,
  location_address: '123 Main St',
  location_lat: 40.7128,
  location_lng: -74.006,
  starting_bid_cents: 10000,
  offer_accepted_cents: null,
  auction_duration_hours: 48,
  auction_ends_at: new Date(Date.now() + 86400000).toISOString(),
  bid_count: 0,
  lowest_bid_cents: null,
  market_range: null,
  auction_type: 'live',
  snipe_extension_count: 0,
  original_auction_ends_at: null,
  created_at: '2026-03-01T12:00:00Z',
  updated_at: '2026-03-01T12:00:00Z',
  customer_display_name: 'Test Customer',
  customer_avatar_url: null,
  customer_member_since: '2025-01-01T00:00:00Z',
  customer_jobs_posted: 5,
};

describe('AuctionArena', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuctionStream).mockReturnValue({ ...defaultStreamReturn });
    vi.mocked(useLiveAuctionState).mockReturnValue({
      data: null,
      isLoading: false,
    } as unknown as ReturnType<typeof useLiveAuctionState>);
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('renders Live Auction header', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText('Live Auction')).toBeDefined();
  });

  it('shows RECONNECTING when disconnected', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText('RECONNECTING')).toBeDefined();
  });

  it('shows LIVE when connected', () => {
    vi.mocked(useAuctionStream).mockReturnValue({ ...defaultStreamReturn,
      events: [],
      connectionStatus: 'connected',
      currentLowest: 0,
      bidCount: 0,
      auctionEndsAt: null,
      snipeExtensionCount: 0,
      isConnected: true,
    });

    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText('LIVE')).toBeDefined();
  });

  it('shows CONNECTING when connecting', () => {
    vi.mocked(useAuctionStream).mockReturnValue({ ...defaultStreamReturn,
      events: [],
      connectionStatus: 'connecting',
      currentLowest: 0,
      bidCount: 0,
      auctionEndsAt: null,
      snipeExtensionCount: 0,
      isConnected: false,
    });

    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText('CONNECTING')).toBeDefined();
  });

  it('displays current lowest bid formatted as currency', () => {
    vi.mocked(useAuctionStream).mockReturnValue({ ...defaultStreamReturn,
      events: [],
      connectionStatus: 'connected',
      currentLowest: 25000,
      bidCount: 3,
      auctionEndsAt: null,
      snipeExtensionCount: 0,
      isConnected: true,
    });

    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    // AnimatedPrice renders each character in its own span for the tumble
    // animation, so the flat text "$250" never appears as a single text
    // node. The component exposes the formatted amount via aria-label.
    expect(screen.getByLabelText('Current lowest bid: $250')).toBeDefined();
  });

  it('displays bid count', () => {
    vi.mocked(useAuctionStream).mockReturnValue({ ...defaultStreamReturn,
      events: [],
      connectionStatus: 'connected',
      currentLowest: 25000,
      bidCount: 3,
      auctionEndsAt: null,
      snipeExtensionCount: 0,
      isConnected: true,
    });

    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText('3')).toBeDefined();
  });

  it('shows em dash when no lowest bid', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText('\u2014')).toBeDefined();
  });

  it('displays snipe extension count via SnipeIndicator', () => {
    vi.mocked(useAuctionStream).mockReturnValue({ ...defaultStreamReturn,
      events: [],
      connectionStatus: 'connected',
      currentLowest: 25000,
      bidCount: 5,
      auctionEndsAt: null,
      snipeExtensionCount: 2,
      isConnected: true,
    });

    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText('2/3 extensions')).toBeDefined();
  });

  it('renders Price History section', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText('Price History')).toBeDefined();
  });

  it('shows bid form for providers who are not the job owner', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: true,
        isJobOwner: false,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByTestId('bid-form')).toBeDefined();
  });

  it('hides bid form for the job owner', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: true,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.queryByTestId('bid-form')).toBeNull();
  });

  it('hides bid form for non-providers', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: false,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.queryByTestId('bid-form')).toBeNull();
  });

  it('hides bid form when job is not active', () => {
    const closedJob: JobDetail = { ...mockJobDetail, status: 'closed' };

    render(
      createElement(AuctionArena, {
        job: closedJob,
        isProvider: true,
        isJobOwner: false,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.queryByTestId('bid-form')).toBeNull();
  });

  it('calls useAuctionStream with the job id', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(vi.mocked(useAuctionStream)).toHaveBeenCalledWith('job-1');
  });

  it('falls back to REST auction state when WebSocket data is absent', () => {
    vi.mocked(useAuctionStream).mockReturnValue({ ...defaultStreamReturn,
      events: [],
      connectionStatus: 'disconnected',
      currentLowest: 0,
      bidCount: 0,
      auctionEndsAt: null,
      snipeExtensionCount: 0,
      isConnected: false,
    });

    vi.mocked(useLiveAuctionState).mockReturnValue({
      data: {
        job_id: 'job-1',
        lowest_bid_cents: 15000,
        bid_count: 2,
        auction_ends_at: '2026-03-05T12:00:00Z',
        snipe_extension_count: 1,
        max_snipe_extensions: 3,
        recent_events: [],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useLiveAuctionState>);

    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );

    // AnimatedPrice fragments the $150 into per-character spans; the
    // aria-label is the stable reading.
    expect(screen.getByLabelText('Current lowest bid: $150')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('1/3 extensions')).toBeDefined();
  });

  it('renders stat labels', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText('Current Lowest Bid')).toBeDefined();
    expect(screen.getByText('Bids')).toBeDefined();
    expect(screen.getByText('0/3 extensions')).toBeDefined();
  });

  // ---- DEEPENING TESTS ----

  it('switches to the Depth Chart tab when clicked', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    const depthTab = screen.getByRole('tab', { name: /depth chart/i });
    expect(depthTab.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(depthTab);
    const depthTabAfter = screen.getByRole('tab', { name: /depth chart/i });
    expect(depthTabAfter.getAttribute('aria-selected')).toBe('true');
  });

  it('renders the order book and social proof when the bids query returns active bids', () => {
    const sampleBids: BidWithProvider[] = [
      {
        bid: {
          id: 'b-1',
          job_id: 'job-1',
          provider_id: 'p-1',
          amount_cents: 25000,
          is_offer_accepted: false,
          status: 'active',
          original_amount_cents: 25000,
          bid_history: [],
          created_at: '2026-03-01T12:00:00Z',
          updated_at: '2026-03-01T12:00:00Z',
          awarded_at: null,
          withdrawn_at: null,
        },
        provider_display_name: 'Bob Builder',
        provider_business_name: 'Bobs LLC',
        provider_avatar_url: null,
        trust_score: { overall_score: 0.8, tier: 'top_rated' },
        review_summary: { average_rating: 4.5, review_count: 10, on_time_rate: 0.9 },
        jobs_completed: 12,
      },
      {
        bid: {
          id: 'b-2',
          job_id: 'job-1',
          provider_id: 'p-2',
          amount_cents: 30000,
          is_offer_accepted: false,
          status: 'withdrawn',
          original_amount_cents: 30000,
          bid_history: [],
          created_at: '2026-03-01T12:00:00Z',
          updated_at: '2026-03-01T12:00:00Z',
          awarded_at: null,
          withdrawn_at: null,
        },
        provider_display_name: 'Excluded Provider',
        provider_business_name: null,
        provider_avatar_url: null,
        trust_score: null,
        review_summary: null,
        jobs_completed: 1,
      },
    ];
    vi.mocked(useBidsForJob).mockReturnValue({
      data: { bids: sampleBids, total: 2 },
      isLoading: false,
    } as unknown as ReturnType<typeof useBidsForJob>);
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      isConnected: true,
      currentLowest: 25000,
      bidCount: 1,
    });
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    // Active provider name appears via the OrderBook
    expect(screen.getByText(/Bobs LLC/)).toBeDefined();
    // Withdrawn provider should be filtered out
    expect(screen.queryByText('Excluded Provider')).toBeNull();
    // Social proof line for 1 provider
    expect(screen.getByText(/1 provider\b/i)).toBeDefined();
  });

  it('shows the SavingsHero when current lowest is below the starting price', () => {
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      currentLowest: 6000,
      bidCount: 1,
      isConnected: true,
    });
    render(
      createElement(AuctionArena, {
        job: { ...mockJobDetail, starting_bid_cents: 10000 },
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(screen.getByText(/You're saving/)).toBeDefined();
  });

  it('returns null when ENABLE_LIVE_AUCTION is false', async () => {
    vi.resetModules();
    vi.doMock('@/lib/constants', () => ({ ENABLE_LIVE_AUCTION: false }));
    const { AuctionArena: GatedArena } = await import('@/components/bids/AuctionArena');
    const { container } = render(
      createElement(GatedArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    expect(container.firstChild).toBeNull();
    vi.doUnmock('@/lib/constants');
  });

  it('renders the savings celebration overlay when the auction has ended with savings', () => {
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      currentLowest: 6000,
      bidCount: 1,
      isConnected: true,
      auctionEndsAt: new Date(Date.now() - 1000).toISOString(),
    });
    render(
      createElement(AuctionArena, {
        job: {
          ...mockJobDetail,
          starting_bid_cents: 10000,
          status: 'awarded',
          market_range: {
            low_cents: 5000,
            median_cents: 9000,
            high_cents: 12000,
            sample_size: 5,
          },
        },
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    // SavingsCelebration overlay surfaces a heading or savings dollar value
    expect(screen.getAllByText(/saving/i).length).toBeGreaterThan(0);
  });

  it('renders the market range display when the job has a populated sample size', () => {
    render(
      createElement(AuctionArena, {
        job: {
          ...mockJobDetail,
          market_range: {
            low_cents: 5000,
            median_cents: 12500,
            high_cents: 25000,
            sample_size: 10,
          },
        },
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    // The MarketRangeDisplay component renders the words "Market" or similar.
    // We just assert the median price shows up in the rendered tree.
    expect(screen.getAllByText(/\$125/).length).toBeGreaterThan(0);
  });

  // ---- WAVE 13 DEEPENING TESTS ----

  it('switches back to the Price History tab after a Depth Chart click', () => {
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    const depthTab = screen.getByRole('tab', { name: /depth chart/i });
    fireEvent.click(depthTab);
    const priceTab = screen.getByRole('tab', { name: /price history/i });
    fireEvent.click(priceTab);
    expect(priceTab.getAttribute('aria-selected')).toBe('true');
  });

  it('renders the bid velocity indicator when velocity > 0', () => {
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      isConnected: true,
      velocity: 4,
      velocityBuckets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    // BidVelocityIndicator exposes an aria-label naming the velocity value.
    expect(screen.getByLabelText(/Bid velocity:.*4.*bids per minute/i)).toBeDefined();
  });

  it('builds the bid activity feed from displayEvents and marks the lowest-amount entry', () => {
    const events = [
      {
        job_id: 'job-1',
        amount_cents: 9000,
        event_type: 'bid_placed' as const,
        created_at: '2026-03-01T12:00:00Z',
      },
      {
        job_id: 'job-1',
        amount_cents: 7000,
        event_type: 'bid_updated' as const,
        created_at: '2026-03-01T12:01:00Z',
      },
      // Withdrawn events filter out — should not appear
      {
        job_id: 'job-1',
        amount_cents: 5000,
        event_type: 'bid_withdrawn' as const,
        created_at: '2026-03-01T12:02:00Z',
      },
    ];
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      events,
      isConnected: true,
      currentLowest: 7000,
      bidCount: 2,
    });
    render(
      createElement(AuctionArena, {
        job: mockJobDetail,
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    // The BidActivityFeed renders provider labels for each retained event.
    expect(screen.getByText('Provider 1')).toBeDefined();
    expect(screen.getByText('Provider 2')).toBeDefined();
    // Withdrawn event is filtered out → no Provider 3 in the activity feed.
    expect(screen.queryByText('Provider 3')).toBeNull();
  });

  it('uses extreme urgency styling on the countdown when less than 5 minutes remain', () => {
    const auctionEndsAt = new Date(Date.now() + 60 * 1000).toISOString(); // 1 min
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      isConnected: true,
      auctionEndsAt,
    });
    render(
      createElement(AuctionArena, {
        job: { ...mockJobDetail, auction_ends_at: auctionEndsAt },
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    // The "extreme" urgency tints the timer red-500 — verify the colour class
    // applied via the colorMap lookup.
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-red-500');
  });

  it('uses critical urgency styling between 5 and 15 minutes remaining', () => {
    const auctionEndsAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      isConnected: true,
      auctionEndsAt,
    });
    render(
      createElement(AuctionArena, {
        job: { ...mockJobDetail, auction_ends_at: auctionEndsAt },
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-red-400');
  });

  it('uses warning urgency styling between 15 and 60 minutes remaining', () => {
    const auctionEndsAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      isConnected: true,
      auctionEndsAt,
    });
    render(
      createElement(AuctionArena, {
        job: { ...mockJobDetail, auction_ends_at: auctionEndsAt },
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-amber-400');
  });

  it('uses ended urgency styling when the auction has expired', () => {
    const auctionEndsAt = new Date(Date.now() - 1000).toISOString();
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      isConnected: true,
      auctionEndsAt,
    });
    render(
      createElement(AuctionArena, {
        job: { ...mockJobDetail, auction_ends_at: auctionEndsAt },
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-muted-foreground');
  });

  it('closes the savings celebration overlay when the dialog backdrop is clicked', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    vi.mocked(useAuctionStream).mockReturnValue({
      ...defaultStreamReturn,
      currentLowest: 6000,
      bidCount: 1,
      isConnected: true,
      auctionEndsAt: past,
    });
    render(
      createElement(AuctionArena, {
        job: {
          ...mockJobDetail,
          starting_bid_cents: 10000,
          status: 'awarded',
          market_range: {
            low_cents: 5000,
            median_cents: 9000,
            high_cents: 12000,
            sample_size: 5,
          },
        },
        isProvider: false,
        isJobOwner: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );
    // SavingsCelebration renders a role="dialog" backdrop whose onClick fires
    // handleCloseCelebration. Clicking the dialog dismisses the overlay,
    // which exercises the AuctionArena close handler.
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    // After close, the dialog unmounts.
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
