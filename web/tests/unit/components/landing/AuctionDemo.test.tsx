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
});
