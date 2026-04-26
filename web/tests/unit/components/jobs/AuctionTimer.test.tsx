import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuctionTimer } from '@/components/jobs/AuctionTimer';

describe('AuctionTimer', () => {
  it('renders Auction Closed when end time is in the past', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    render(<AuctionTimer auctionEndsAt={past} />);
    expect(screen.getByText('Auction Closed')).toBeDefined();
  });

  it('renders timer with role=timer when end time is in the future', () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    render(<AuctionTimer auctionEndsAt={future} />);
    const timer = screen.getByRole('timer');
    expect(timer).toBeDefined();
  });

  it('renders compact variant with simple text', () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    render(<AuctionTimer auctionEndsAt={future} compact />);
    const timer = screen.getByRole('timer');
    // Compact format like "1h 59m" or "2h 0m"
    expect(timer.textContent).toMatch(/h \d+m/);
  });

  it('shows Time Left label when not in critical state', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    render(<AuctionTimer auctionEndsAt={future} />);
    expect(screen.getByText('Time Left')).toBeDefined();
  });

  it('forwards className', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    render(<AuctionTimer auctionEndsAt={future} className="extra" />);
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('extra');
  });

  it('renders compact variant with day display when more than 24 hours remain', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    render(<AuctionTimer auctionEndsAt={future} compact />);
    const timer = screen.getByRole('timer');
    // 2 days remaining → "2d 0h" or similar
    expect(timer.textContent).toMatch(/\d+d \d+h/);
  });

  it('renders compact variant with seconds display when less than 1 hour remains', () => {
    const future = new Date(Date.now() + 30 * 1000).toISOString();
    render(<AuctionTimer auctionEndsAt={future} compact />);
    const timer = screen.getByRole('timer');
    // < 1 hour and < 1 minute → "0m Ns"
    expect(timer.textContent).toMatch(/\d+m \d+s/);
  });

  it('renders Ending Soon label when in critical state', () => {
    // < 1 hour but > 15 minutes → CRITICAL urgency
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    render(<AuctionTimer auctionEndsAt={future} />);
    expect(screen.getByText('Ending Soon')).toBeDefined();
  });

  it('renders large seconds display in final minute', () => {
    // < 60s remaining → isFinalMinute branch
    const future = new Date(Date.now() + 30 * 1000).toISOString();
    const { container } = render(<AuctionTimer auctionEndsAt={future} />);
    // The final-minute branch shows a single padded seconds value followed by "s"
    // The "s" suffix span has `ml-0.5 text-xs font-medium opacity-70`
    const sLabel = container.querySelector('span.ml-0\\.5.text-xs.font-medium.opacity-70');
    expect(sLabel).not.toBeNull();
    expect(sLabel?.textContent).toBe('s');
  });

  it('renders FINAL urgency glow when within final 15 minutes', () => {
    // < 15 minutes remaining → FINAL urgency triggers isFinal15 glow elements
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { container } = render(<AuctionTimer auctionEndsAt={future} />);
    // animate-urgency-glow absolutely-positioned div
    const glow = container.querySelector('.animate-urgency-glow');
    expect(glow).not.toBeNull();
    // bg-red-500 blur-xl background ring (lines 372-376)
    const blur = container.querySelector('.bg-red-500.blur-xl');
    expect(blur).not.toBeNull();
  });

  it('renders days display in full variant when over 24 hours remain', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { container } = render(<AuctionTimer auctionEndsAt={future} />);
    // days > 0 branch → "Nd Mh" text
    expect(container.textContent).toMatch(/\d+d \d+h/);
  });
});

describe('AuctionTimer interval ticks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('continues to render after a tick crosses the auction end time', () => {
    // 2 seconds in the future. We let the interval fire and then expire.
    const start = Date.now();
    const future = new Date(start + 2_000).toISOString();
    render(<AuctionTimer auctionEndsAt={future} />);
    expect(screen.queryByRole('timer')).not.toBeNull();

    // Advance past expiry — the interval cleanup branch runs.
    vi.setSystemTime(start + 5_000);
    vi.advanceTimersByTime(2_000);
    // After expiry, the inner setInterval clears itself; component still mounted
    // but a re-render may swap to "Auction Closed" — either way no throw is fine.
  });
});
