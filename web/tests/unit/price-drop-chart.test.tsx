import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { PriceDropChart } from '@/components/bids/PriceDropChart';
import type { AuctionBidEvent } from '@/types';

// jsdom does not include ResizeObserver — provide a minimal stub
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

describe('PriceDropChart', () => {
  it('shows empty state with no events', () => {
    render(<PriceDropChart events={[]} />);
    expect(
      screen.getByText(/no bids yet/i),
    ).toBeDefined();
  });

  it('has accessible aria-label on empty state', () => {
    render(<PriceDropChart events={[]} />);
    const chart = screen.getByRole('img');
    expect(chart.getAttribute('aria-label')).toContain('no bids yet');
  });

  it('renders SVG with a single bid_placed event', () => {
    const events: AuctionBidEvent[] = [
      {
        job_id: 'job-1',
        amount_cents: 50000,
        event_type: 'bid_placed',
        created_at: new Date().toISOString(),
      },
    ];
    render(<PriceDropChart events={events} />);
    const svg = screen.getByRole('img');
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('aria-label')).toContain('1 price');
    expect(svg.getAttribute('aria-label')).toContain('$500');
  });

  it('renders multiple events with correct count and lowest price', () => {
    const now = Date.now();
    const events: AuctionBidEvent[] = [
      {
        job_id: 'job-1',
        amount_cents: 50000,
        event_type: 'bid_placed',
        created_at: new Date(now).toISOString(),
      },
      {
        job_id: 'job-1',
        amount_cents: 45000,
        event_type: 'bid_placed',
        created_at: new Date(now + 60000).toISOString(),
      },
      {
        job_id: 'job-1',
        amount_cents: 40000,
        event_type: 'bid_placed',
        created_at: new Date(now + 120000).toISOString(),
      },
    ];
    render(<PriceDropChart events={events} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('3 price');
    expect(svg.getAttribute('aria-label')).toContain('$400');
  });

  it('includes bid_updated events in the chart', () => {
    const now = Date.now();
    const events: AuctionBidEvent[] = [
      {
        job_id: 'job-1',
        amount_cents: 50000,
        event_type: 'bid_placed',
        created_at: new Date(now).toISOString(),
      },
      {
        job_id: 'job-1',
        amount_cents: 42000,
        event_type: 'bid_updated',
        created_at: new Date(now + 60000).toISOString(),
      },
    ];
    render(<PriceDropChart events={events} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('2 price');
    expect(svg.getAttribute('aria-label')).toContain('$420');
  });

  it('filters out bid_withdrawn events', () => {
    const now = Date.now();
    const events: AuctionBidEvent[] = [
      {
        job_id: 'job-1',
        amount_cents: 50000,
        event_type: 'bid_placed',
        created_at: new Date(now).toISOString(),
      },
      {
        job_id: 'job-1',
        amount_cents: 50000,
        event_type: 'bid_withdrawn',
        created_at: new Date(now + 60000).toISOString(),
      },
    ];
    render(<PriceDropChart events={events} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('1 price');
  });

  it('computes running minimum correctly', () => {
    const now = Date.now();
    const events: AuctionBidEvent[] = [
      {
        job_id: 'job-1',
        amount_cents: 30000,
        event_type: 'bid_placed',
        created_at: new Date(now).toISOString(),
      },
      {
        job_id: 'job-1',
        amount_cents: 50000,
        event_type: 'bid_placed',
        created_at: new Date(now + 60000).toISOString(),
      },
      {
        job_id: 'job-1',
        amount_cents: 20000,
        event_type: 'bid_placed',
        created_at: new Date(now + 120000).toISOString(),
      },
    ];
    render(<PriceDropChart events={events} />);
    const svg = screen.getByRole('img');
    // Running minimum ends at 20000 ($200)
    expect(svg.getAttribute('aria-label')).toContain('$200');
  });

  it('renders circle elements for each price step', () => {
    const now = Date.now();
    const events: AuctionBidEvent[] = [
      {
        job_id: 'job-1',
        amount_cents: 50000,
        event_type: 'bid_placed',
        created_at: new Date(now).toISOString(),
      },
      {
        job_id: 'job-1',
        amount_cents: 40000,
        event_type: 'bid_placed',
        created_at: new Date(now + 60000).toISOString(),
      },
    ];
    const { container } = render(<PriceDropChart events={events} />);
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(2);
  });

  it('renders a step path element', () => {
    const events: AuctionBidEvent[] = [
      {
        job_id: 'job-1',
        amount_cents: 50000,
        event_type: 'bid_placed',
        created_at: new Date().toISOString(),
      },
    ];
    const { container } = render(<PriceDropChart events={events} />);
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')).toContain('M');
  });
});
