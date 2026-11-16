import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarketRangeDisplay } from '@/components/analytics/MarketRangeDisplay';
import type { AnalyticsMarketRange } from '@/types';

function makeRange(overrides: Partial<AnalyticsMarketRange> = {}): AnalyticsMarketRange {
  return {
    has_data: true,
    category_id: 'cat-1',
    subcategory_id: 'sub-1',
    service_type_id: 'svc-1',
    region: 'austin',
    low_cents: 10000,
    median_cents: 25000,
    high_cents: 50000,
    data_points: 12,
    source: 'historical',
    confidence: 0.85,
    computed_at: '2026-03-01T12:00:00Z',
    ...overrides,
  };
}

describe('MarketRangeDisplay', () => {
  it('renders the heading and source badge', () => {
    render(<MarketRangeDisplay range={makeRange()} />);
    expect(screen.getByText('Market Price Range')).toBeDefined();
    expect(screen.getByText('historical')).toBeDefined();
  });

  it('renders low, median and high prices formatted as currency', () => {
    render(<MarketRangeDisplay range={makeRange()} />);
    expect(screen.getByText('$100.00')).toBeDefined();
    // Median appears both in the bar aria-label and the bottom row
    expect(screen.getAllByText('$250.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$500.00')).toBeDefined();
  });

  it('shows the data points count with proper pluralization', () => {
    render(<MarketRangeDisplay range={makeRange({ data_points: 1 })} />);
    expect(screen.getByText(/1 data point$/)).toBeDefined();
  });

  it('labels confidence as High when >= 0.8', () => {
    render(<MarketRangeDisplay range={makeRange({ confidence: 0.9 })} />);
    expect(screen.getByText(/High \(90%\)/)).toBeDefined();
  });

  it('labels confidence as Medium when between 0.5 and 0.8', () => {
    render(<MarketRangeDisplay range={makeRange({ confidence: 0.6 })} />);
    expect(screen.getByText(/Medium \(60%\)/)).toBeDefined();
  });

  it('labels confidence as Low when < 0.5', () => {
    render(<MarketRangeDisplay range={makeRange({ confidence: 0.2 })} />);
    expect(screen.getByText(/Low \(20%\)/)).toBeDefined();
  });

  it('forwards className to the root element', () => {
    const { container } = render(
      <MarketRangeDisplay range={makeRange()} className="custom-range" />,
    );
    expect(container.querySelector('.custom-range')).not.toBeNull();
  });

  it('exposes the median position via aria-label', () => {
    const { container } = render(<MarketRangeDisplay range={makeRange()} />);
    const marker = container.querySelector('[aria-label^="Median price at"]');
    expect(marker).not.toBeNull();
  });
});
