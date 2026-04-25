import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LiveBidTicker } from '@/components/bids/LiveBidTicker';

describe('LiveBidTicker', () => {
  it('renders the current lowest bid label', () => {
    render(
      <LiveBidTicker currentBid={20000} startingPrice={30000} totalBids={3} />,
    );
    expect(screen.getByText('Current lowest bid')).toBeDefined();
  });

  it('formats the current bid as USD', () => {
    render(
      <LiveBidTicker currentBid={20000} startingPrice={30000} totalBids={3} />,
    );
    expect(screen.getByText('$200.00')).toBeDefined();
  });

  it('shows total bid count', () => {
    render(
      <LiveBidTicker currentBid={20000} startingPrice={30000} totalBids={7} />,
    );
    expect(screen.getByText('7')).toBeDefined();
    expect(screen.getByText('bids')).toBeDefined();
  });

  it('displays a savings pill when previousBid is supplied', () => {
    render(
      <LiveBidTicker
        currentBid={20000}
        previousBid={25000}
        startingPrice={30000}
        totalBids={3}
      />,
    );
    // 33% below ask
    expect(screen.getByText(/33% below ask/i)).toBeDefined();
  });

  it('shows watcher count when supplied', () => {
    render(
      <LiveBidTicker
        currentBid={20000}
        startingPrice={30000}
        totalBids={3}
        watcherCount={42}
      />,
    );
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('watching')).toBeDefined();
  });

  it('shows time remaining when supplied', () => {
    render(
      <LiveBidTicker
        currentBid={20000}
        startingPrice={30000}
        totalBids={3}
        timeRemaining="12m 30s"
      />,
    );
    expect(screen.getByText('12m 30s')).toBeDefined();
    expect(screen.getByText('left')).toBeDefined();
  });

  it('exposes an aria-label for the current bid', () => {
    render(
      <LiveBidTicker currentBid={20000} startingPrice={30000} totalBids={3} />,
    );
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-label')).toContain('$200.00');
  });
});
