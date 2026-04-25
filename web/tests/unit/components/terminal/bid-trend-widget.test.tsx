// BidTrendWidget — wrapper around BidPriceChart sparkline.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/bids/BidPriceChart', () => ({
  BidPriceChart: ({ bids, height }: { bids: number[]; height: number }) =>
    createElement(
      'div',
      { 'data-testid': 'bid-price-chart' },
      `bids:${String(bids.length)} h:${String(height)}`,
    ),
}));

import { BidTrendWidget } from '@/components/terminal/widgets/bid-trend-widget';
import { makeWidgetProps } from './_fixtures';

describe('BidTrendWidget', () => {
  it('renders Bid Trend header', () => {
    render(createElement(BidTrendWidget, makeWidgetProps()));
    expect(screen.getByText('Bid Trend')).toBeDefined();
  });

  it('passes sparkline data and height to BidPriceChart', () => {
    render(createElement(BidTrendWidget, makeWidgetProps()));
    expect(screen.getByTestId('bid-price-chart').textContent).toBe('bids:5 h:180');
  });
});
