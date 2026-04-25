import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
