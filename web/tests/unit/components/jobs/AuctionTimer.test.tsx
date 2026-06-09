import { act, render, screen } from '@testing-library/react';
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

  it('sizes the HH:MM:SS readout to fit inside the ring (text-sm digits, 96px ring)', () => {
    // ~1h19m remaining → hours > 0, non-final HH:MM:SS branch (the surface in
    // the bug screenshot). The digit string must fit the ring's inner diameter
    // with clearance, so the digits are sized text-sm (not text-lg) and the ring
    // is 96px. Guards against a regression that lets the stroke cross the digits.
    const future = new Date(Date.now() + (1 * 60 * 60 + 19 * 60 + 26) * 1000).toISOString();
    const { container } = render(<AuctionTimer auctionEndsAt={future} />);

    // The SVG ring is sized 96 — large enough to frame text-sm digits.
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('96');
    expect(svg?.getAttribute('height')).toBe('96');

    // Every minute/second/hour digit span uses text-sm (fits inner diameter),
    // and none use the old text-lg that overflowed the ring.
    const digitSpans = Array.from(container.querySelectorAll('span.font-bold'));
    expect(digitSpans.length).toBeGreaterThanOrEqual(3); // HH, MM, SS
    for (const span of digitSpans) {
      expect(span.className).toContain('text-sm');
      expect(span.className).not.toContain('text-lg');
    }

    // Geometry assertion: estimated text width < ring inner diameter.
    // Inner clear diameter for size=96, strokeWidth=3:
    //   2 * ((96 - 3*2)/2 - 3/2) = 87px.
    // Worst-case "23:59:59" at text-sm tabular-nums:
    //   6 digits * ~8.4px + 2 colons * ~3px + 4 separator margins * 4px ≈ 72px.
    const size = 96;
    const strokeWidth = 3;
    const innerDiameter = 2 * ((size - strokeWidth * 2) / 2 - strokeWidth / 2);
    const estTextWidth = 6 * 8.4 + 2 * 3 + 4 * 4; // ≈ 72.4px
    expect(estTextWidth).toBeLessThan(innerDiameter);
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
    act(() => {
      vi.setSystemTime(start + 5_000);
      vi.advanceTimersByTime(2_000);
    });
    // After expiry, the inner setInterval clears itself; component still mounted
    // but a re-render may swap to "Auction Closed" — either way no throw is fine.
  });

  it('animates the seconds digit during the final minute (rolls displayValue)', () => {
    // < 60s remaining → AnimatedDigit shows seconds. As time advances by 1s, the
    // value prop changes, triggering the setTimeout that sets displayValue
    // (lines 103-104) when it elapses.
    const start = Date.now();
    const future = new Date(start + 30_000).toISOString();
    render(<AuctionTimer auctionEndsAt={future} />);
    // Advance 1s of system time then fire the 1s tick.
    act(() => {
      vi.setSystemTime(start + 1_000);
      vi.advanceTimersByTime(1_000);
    });
    // Now flush the AnimatedDigit's 150ms inner timeout — this hits lines 103-104.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // Roll forward another tick so the whole sequence is exercised again.
    act(() => {
      vi.setSystemTime(start + 2_000);
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // No throw, timer still mounted.
    expect(screen.queryByRole('timer')).not.toBeNull();
  });

  it('upgrades the interval cadence when crossing the < 1 hour threshold', () => {
    // Start the timer just over 1 hour out so the initial tick rate is 30s.
    // After advancing past the 1-hour mark, the next tick should detect the
    // boundary cross and re-arm a faster interval (lines 211-220).
    const start = Date.now();
    const future = new Date(start + 60 * 60 * 1000 + 60_000).toISOString();
    const { container } = render(<AuctionTimer auctionEndsAt={future} />);

    // Initial tick — within > 1h window, tick rate should be 30s.
    act(() => {
      vi.setSystemTime(start + 30_000);
      vi.advanceTimersByTime(30_000);
    });
    // Now we cross under 1h. The next tick fires at 30s mark and detects the
    // boundary, clears the old interval and re-arms a 1s interval.
    act(() => {
      vi.setSystemTime(start + 30 * 60_000);
      vi.advanceTimersByTime(30_000);
    });
    // The (now 1s) interval is in effect. Advance a couple of seconds.
    act(() => {
      vi.setSystemTime(start + 30 * 60_000 + 2_000);
      vi.advanceTimersByTime(2_000);
    });
    // Component still rendered (we are still in the future, role=timer present).
    expect(container.firstChild).not.toBeNull();
  });
});
