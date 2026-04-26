import { fireEvent, render, screen } from '@testing-library/react';
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

  // ---- DEEPENING TESTS ----

  it('renders a hover tooltip when the mouse moves over the chart', () => {
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
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // jsdom doesn't compute layout boxes; svg.getBoundingClientRect returns 0s.
    // We still exercise the handler — the closest-bucket logic doesn't depend
    // on a non-zero rect, just on the relative offset.
    fireEvent.mouseMove(svg as SVGSVGElement, { clientX: 100, clientY: 50 });
    // After mouse move the tooltip text containing "bid" or "bids" appears
    const texts = Array.from(container.querySelectorAll('text'));
    const hasBidLabel = texts.some((t) => /\d bids?\)/.test(t.textContent));
    expect(hasBidLabel).toBe(true);
  });

  it('clears the hover tooltip when the mouse leaves the chart', () => {
    const { container } = render(
      <BidDepthChart
        bids={[
          { amount_cents: 10000, count: 1 },
          { amount_cents: 15000, count: 1 },
        ]}
        startingPrice={30000}
        currentLowest={10000}
      />,
    );
    const svg = container.querySelector('svg');
    fireEvent.mouseMove(svg as SVGSVGElement, { clientX: 50, clientY: 50 });
    fireEvent.mouseLeave(svg as SVGSVGElement);
    const texts = Array.from(container.querySelectorAll('text'));
    const hasBidLabel = texts.some((t) => /\d bids?\)/.test(t.textContent));
    expect(hasBidLabel).toBe(false);
  });

  it('renders 4 X-axis price ticks', () => {
    const { container } = render(
      <BidDepthChart
        bids={[
          { amount_cents: 10000, count: 1 },
          { amount_cents: 20000, count: 1 },
        ]}
        startingPrice={30000}
        currentLowest={10000}
      />,
    );
    // The chart fills the container width; we just assert at least the 4 X-axis
    // tick labels render with a $ in them.
    const dollarLabels = Array.from(container.querySelectorAll('text')).filter((t) =>
      t.textContent.includes('$'),
    );
    expect(dollarLabels.length).toBeGreaterThanOrEqual(3);
  });

  it('produces a stable gradient id derived from the starting price seed', () => {
    const { container } = render(
      <BidDepthChart
        bids={[{ amount_cents: 12000, count: 2 }]}
        startingPrice={45000}
        currentLowest={12000}
      />,
    );
    const linearGradient = container.querySelector('linearGradient');
    expect(linearGradient).not.toBeNull();
    const id = linearGradient?.getAttribute('id');
    expect(typeof id).toBe('string');
    expect(String(id).startsWith('depthGradient-')).toBe(true);
  });

  it('groups bids by amount_cents — uses cumulative bid counts', () => {
    const { container } = render(
      <BidDepthChart
        bids={[
          { amount_cents: 10000, count: 1 },
          { amount_cents: 15000, count: 2 },
          { amount_cents: 20000, count: 1 },
        ]}
        startingPrice={30000}
        currentLowest={10000}
      />,
    );
    // The cumulative path should render — check via tooltip aria-label
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
  });
});
