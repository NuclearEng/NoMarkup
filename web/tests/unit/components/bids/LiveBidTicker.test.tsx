import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

  it('renders an "up" direction pill (red, rotated icon) when currentBid > previousBid', () => {
    // Exercises the 'up' branch in the direction ternary (lines 31-33) and
    // the rotate-180 + red color classes (line 74).
    const { container } = render(
      <LiveBidTicker
        currentBid={28000}
        previousBid={20000}
        startingPrice={30000}
        totalBids={4}
      />,
    );
    // Direction is 'up' so a percent-below-ask pill renders. With currentBid 28000
    // and startingPrice 30000, savings is 7%.
    expect(screen.getByText(/7% below ask/i)).toBeDefined();
    // The pill's icon should have the rotate-180 class (TrendingDown rotated up).
    const rotated = container.querySelector('.rotate-180');
    expect(rotated).not.toBeNull();
    // The up pill uses red classes.
    const up = container.querySelector('.bg-red-50');
    expect(up).not.toBeNull();
  });

  it('omits the direction pill entirely when currentBid equals previousBid (flat)', () => {
    // direction === 'flat' branch — pill is suppressed.
    const { container } = render(
      <LiveBidTicker
        currentBid={20000}
        previousBid={20000}
        startingPrice={30000}
        totalBids={3}
      />,
    );
    expect(container.querySelector('.bg-emerald-50')).toBeNull();
    expect(container.querySelector('.bg-red-50')).toBeNull();
  });

  it('handles startingPrice of 0 without dividing by zero (savings stays 0)', () => {
    render(
      <LiveBidTicker
        currentBid={10000}
        previousBid={20000}
        startingPrice={0}
        totalBids={1}
      />,
    );
    // With startingPrice 0, savings is 0 — we still render the down pill
    // since previousBid > currentBid.
    expect(screen.getByText(/0% below ask/i)).toBeDefined();
  });

  it('flashes the price color on bid changes and clears after 600ms', async () => {
    vi.useFakeTimers();
    const { rerender, container } = render(
      <LiveBidTicker
        currentBid={20000}
        previousBid={25000}
        startingPrice={30000}
        totalBids={3}
      />,
    );
    // Down flash applies emerald-500
    const flashEl = container.querySelector('.text-emerald-500');
    expect(flashEl).not.toBeNull();

    await vi.advanceTimersByTimeAsync(600);
    rerender(
      <LiveBidTicker
        currentBid={20000}
        previousBid={25000}
        startingPrice={30000}
        totalBids={3}
      />,
    );
    expect(container.querySelector('.text-emerald-500')).toBeNull();
    vi.useRealTimers();
  });

  it('does not render the watcher pill when watcherCount is 0', () => {
    const { container } = render(
      <LiveBidTicker
        currentBid={20000}
        startingPrice={30000}
        totalBids={3}
        watcherCount={0}
      />,
    );
    expect(container.textContent).not.toMatch(/watching/i);
  });
});
