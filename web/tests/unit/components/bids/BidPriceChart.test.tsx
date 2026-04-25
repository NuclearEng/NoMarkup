import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BidPriceChart } from '@/components/bids/BidPriceChart';

describe('BidPriceChart', () => {
  it('shows waiting state when fewer than 2 bids are provided', () => {
    render(<BidPriceChart bids={[]} />);
    expect(screen.getByText(/waiting for bids/i)).toBeDefined();
  });

  it('renders an SVG when given 2+ bids', () => {
    const { container } = render(<BidPriceChart bids={[50000, 45000, 40000]} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('marks the chart as trending down when the last bid is lower than the first', () => {
    render(<BidPriceChart bids={[50000, 40000]} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('trending down');
  });

  it('marks the chart as trending up when the last bid is higher than the first', () => {
    render(<BidPriceChart bids={[40000, 50000]} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('trending up');
  });

  it('renders min and max price labels', () => {
    render(<BidPriceChart bids={[10000, 50000, 30000]} />);
    expect(screen.getByText('$500')).toBeDefined();
    expect(screen.getByText('$100')).toBeDefined();
  });
});
