import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { BidDepthChart } from '@/components/bids/BidDepthChart';

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

describe('BidDepthChart', () => {
  it('shows empty state when there are no bids', () => {
    render(
      <BidDepthChart bids={[]} startingPrice={50000} currentLowest={0} />,
    );
    const region = screen.getByRole('img');
    expect(region.getAttribute('aria-label')).toContain('no bids yet');
  });

  it('renders an SVG with 3 buckets and exposes an aria-label with bid counts', () => {
    render(
      <BidDepthChart
        bids={[
          { amount_cents: 25000, count: 1 },
          { amount_cents: 20000, count: 2 },
          { amount_cents: 18000, count: 1 },
        ]}
        startingPrice={50000}
        currentLowest={18000}
      />,
    );
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('3 price levels');
    expect(svg.getAttribute('aria-label')).toContain('lowest at $180');
  });

  it('renders the current lowest marker label', () => {
    const { container } = render(
      <BidDepthChart
        bids={[
          { amount_cents: 20000, count: 2 },
          { amount_cents: 25000, count: 1 },
        ]}
        startingPrice={50000}
        currentLowest={20000}
      />,
    );
    // Marker text node lives inside <text>
    const labels = container.querySelectorAll('text');
    const found = Array.from(labels).some((el) => el.textContent.includes('$200'));
    expect(found).toBe(true);
  });

  it('renders one data-point circle per bucket', () => {
    const { container } = render(
      <BidDepthChart
        bids={[
          { amount_cents: 10000, count: 1 },
          { amount_cents: 15000, count: 1 },
          { amount_cents: 20000, count: 1 },
        ]}
        startingPrice={30000}
        currentLowest={10000}
      />,
    );
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(3);
  });
});
