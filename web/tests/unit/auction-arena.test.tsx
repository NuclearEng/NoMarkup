import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuctionArena } from '@/components/bids/AuctionArena';
import type { JobDetail } from '@/types';

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
const { useLiveAuctionState } = await import('@/hooks/useBids');

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
    return createElement(QueryClientProvider, { client: queryClient }, children);
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
});
