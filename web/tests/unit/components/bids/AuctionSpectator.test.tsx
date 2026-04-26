import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuctionSpectator } from '@/components/bids/AuctionSpectator';

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

vi.mock('@/hooks/useSpectatorStream', () => ({
  useSpectatorStream: vi.fn(),
}));

vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: vi.fn(),
}));

const { useSpectatorStream } = await import('@/hooks/useSpectatorStream');
const { useCountdown } = await import('@/hooks/useCountdown');

const baseStream = {
  events: [],
  connectionStatus: 'connected' as const,
  currentLowest: 0,
  bidCount: 0,
  spectatorCount: 0,
  isConnected: true,
};

const baseCountdown = {
  timeLeft: '12m 30s',
  isExpired: false,
  totalSeconds: 750,
};

describe('AuctionSpectator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSpectatorStream).mockReturnValue(baseStream as unknown as ReturnType<
      typeof useSpectatorStream
    >);
    vi.mocked(useCountdown).mockReturnValue(baseCountdown as unknown as ReturnType<
      typeof useCountdown
    >);
  });

  it('renders Live Auction header with SPECTATOR badge', () => {
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Fix kitchen sink"
        categoryName="Plumbing"
        auctionEndsAt={new Date(Date.now() + 60000).toISOString()}
        startingBidCents={50000}
      />,
    );
    expect(screen.getByText('Live Auction')).toBeDefined();
    expect(screen.getByText('SPECTATOR')).toBeDefined();
  });

  it('renders the job title and category', () => {
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Fix kitchen sink"
        categoryName="Plumbing"
        auctionEndsAt={null}
        startingBidCents={50000}
      />,
    );
    expect(screen.getByText('Fix kitchen sink')).toBeDefined();
    expect(screen.getByText('Plumbing')).toBeDefined();
  });

  it('shows LIVE indicator when connected', () => {
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={null}
        startingBidCents={50000}
      />,
    );
    expect(screen.getByText('LIVE')).toBeDefined();
  });

  it('shows CONNECTING when connecting', () => {
    vi.mocked(useSpectatorStream).mockReturnValue({
      ...baseStream,
      connectionStatus: 'connecting',
      isConnected: false,
    } as unknown as ReturnType<typeof useSpectatorStream>);
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={null}
        startingBidCents={50000}
      />,
    );
    expect(screen.getByText('CONNECTING')).toBeDefined();
  });

  it('renders bid count and spectator count', () => {
    vi.mocked(useSpectatorStream).mockReturnValue({
      ...baseStream,
      currentLowest: 30000,
      bidCount: 5,
      spectatorCount: 12,
    } as unknown as ReturnType<typeof useSpectatorStream>);
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={null}
        startingBidCents={50000}
      />,
    );
    expect(screen.getByText('5')).toBeDefined();
    expect(screen.getByText('12')).toBeDefined();
  });

  it('renders the countdown label', () => {
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={null}
        startingBidCents={50000}
      />,
    );
    expect(screen.getByText('12m 30s')).toBeDefined();
  });

  it('renders savings pill when current bid is below starting', () => {
    vi.mocked(useSpectatorStream).mockReturnValue({
      ...baseStream,
      currentLowest: 30000,
      bidCount: 3,
    } as unknown as ReturnType<typeof useSpectatorStream>);
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={null}
        startingBidCents={50000}
      />,
    );
    expect(screen.getByText(/Saving \$200 vs starting price/i)).toBeDefined();
  });

  // ---- DEEPENING TESTS ----

  it('shows ended urgency when countdown is expired (line 20 branch)', () => {
    vi.mocked(useCountdown).mockReturnValue({
      timeLeft: 'Ended',
      isExpired: true,
      totalSeconds: 0,
    } as unknown as ReturnType<typeof useCountdown>);
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt="2020-01-01T00:00:00Z"
        startingBidCents={50000}
      />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-muted-foreground');
  });

  it('shows critical urgency when 300 < totalSeconds <= 900 (line 23 branch)', () => {
    vi.mocked(useCountdown).mockReturnValue({
      timeLeft: '7m 0s',
      isExpired: false,
      totalSeconds: 420,
    } as unknown as ReturnType<typeof useCountdown>);
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={new Date(Date.now() + 420000).toISOString()}
        startingBidCents={50000}
      />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-red-400');
  });

  it('shows extreme urgency (and pulse animation) when totalSeconds <= 300 (line 24 branch + line 213 style)', () => {
    vi.mocked(useCountdown).mockReturnValue({
      timeLeft: '0m 30s',
      isExpired: false,
      totalSeconds: 30,
    } as unknown as ReturnType<typeof useCountdown>);
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={new Date(Date.now() + 30000).toISOString()}
        startingBidCents={50000}
      />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-red-500');
    // Line 213: extreme path applies countdownPulse animation
    expect(timer.style.animation).toContain('countdownPulse');
  });

  it('shows RECONNECTING when connectionStatus is reconnecting', () => {
    vi.mocked(useSpectatorStream).mockReturnValue({
      ...baseStream,
      connectionStatus: 'reconnecting',
      isConnected: false,
    } as unknown as ReturnType<typeof useSpectatorStream>);
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={null}
        startingBidCents={50000}
      />,
    );
    expect(screen.getByText('RECONNECTING')).toBeDefined();
  });

  it('renders singular "provider" when bidCount === 1 (social-proof branch)', () => {
    vi.mocked(useSpectatorStream).mockReturnValue({
      ...baseStream,
      bidCount: 1,
      currentLowest: 25000,
    } as unknown as ReturnType<typeof useSpectatorStream>);
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={null}
        startingBidCents={50000}
      />,
    );
    // "1 provider" singular (not "providers")
    expect(screen.getByText(/1 provider/)).toBeDefined();
  });

  it('does not render savings pill when starting price is missing', () => {
    vi.mocked(useSpectatorStream).mockReturnValue({
      ...baseStream,
      currentLowest: 0,
    } as unknown as ReturnType<typeof useSpectatorStream>);
    render(
      <AuctionSpectator
        jobId="job-1"
        jobTitle="Job"
        categoryName="Cat"
        auctionEndsAt={null}
        startingBidCents={null}
      />,
    );
    expect(screen.queryByText(/Saving/)).toBeNull();
  });
});
