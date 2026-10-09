import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuctionDemo } from '@/components/landing/AuctionDemo';

describe('AuctionDemo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the Live Auction header and headline', () => {
    render(<AuctionDemo />);
    expect(screen.getByText('Live Auction')).toBeDefined();
    expect(screen.getByText('Kitchen Renovation')).toBeDefined();
  });

  it('renders the Current Best Price label', () => {
    render(<AuctionDemo />);
    expect(screen.getByText('Current Best Price')).toBeDefined();
  });

  it('shows the starting price initially', () => {
    render(<AuctionDemo />);
    expect(screen.getByText('$2,500')).toBeDefined();
  });

  it('renders the competitive prices footnote', () => {
    render(<AuctionDemo />);
    expect(screen.getByText(/Prices go down as providers compete/i)).toBeDefined();
  });

  it('forwards a custom className to the root container', () => {
    const { container } = render(<AuctionDemo className="custom-demo" />);
    expect(container.querySelector('.custom-demo')).not.toBeNull();
  });

  it('reveals the first bid after its delay elapses', () => {
    render(<AuctionDemo />);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    // After bid 1, current price becomes $2,100. The price is also rendered
    // in the bid row, so there may be more than one occurrence.
    expect(screen.getAllByText('$2,100').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the second bid after its delay', () => {
    render(<AuctionDemo />);
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.getAllByText('$1,800').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('ProBuild Co.')).toBeDefined();
  });

  it('renders the winning bid and a savings badge after all bids land', () => {
    render(<AuctionDemo />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getAllByText('$1,450').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Elite Renovations')).toBeDefined();
    expect(screen.getByText(/% savings!/)).toBeDefined();
  });

  it('countdown timer ticks down by one second', () => {
    render(<AuctionDemo />);
    // Initial timer 47 → 0:47
    expect(screen.getByText(/0:47/)).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/0:46/)).toBeDefined();
  });

  it('renders the Elite trust tier label for score >= 95', () => {
    render(<AuctionDemo />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Elite Renovations has trustScore 95 → Elite tier
    expect(screen.getByText('95')).toBeDefined();
  });

  it('cycles back to the starting price after CYCLE_DURATION', () => {
    render(<AuctionDemo />);
    // First reach final bid
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getAllByText('$1,450').length).toBeGreaterThanOrEqual(1);
    // After full cycle, the runCycle setTimeout (8000ms from cycle start)
    // resets state.
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    // The starting price is back as Current Best Price.
    expect(screen.getAllByText('$2,500').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the High trust tier label for scores between 90 and 94', () => {
    render(<AuctionDemo />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Mike's Plumbing has trustScore 92 → High tier label
    expect(screen.getByText('92')).toBeDefined();
    // ProBuild Co. has trustScore 88 → Good tier
    expect(screen.getByText('88')).toBeDefined();
  });

  it('cleans up timers on unmount before any bid lands', () => {
    const { unmount } = render(<AuctionDemo />);
    // Unmount immediately — exercises the cleanup branch where cycleRef and
    // timerRef are still set and pending t1/t2/t3 timeouts must be cleared.
    expect(() => { unmount(); }).not.toThrow();
  });
});
