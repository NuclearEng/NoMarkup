// DepthChartWidget — wrapper around BidDepthChart. We mock the chart to keep
// the test fast and assert the widget chrome (header) plus that it forwards
// data.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/bids/BidDepthChart', () => ({
  BidDepthChart: ({
    bids,
    startingPrice,
    currentLowest,
  }: {
    bids: { amount_cents: number }[];
    startingPrice: number;
    currentLowest: number;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'depth-chart' },
      `b:${String(bids.length)} s:${String(startingPrice)} c:${String(currentLowest)}`,
    ),
}));

import { DepthChartWidget } from '@/components/terminal/widgets/depth-chart-widget';
import { makeWidgetProps } from './_fixtures';

describe('DepthChartWidget', () => {
  it('renders Depth Chart header', () => {
    render(createElement(DepthChartWidget, makeWidgetProps()));
    expect(screen.getByText('Depth Chart')).toBeDefined();
  });

  it('forwards depth buckets and prices to BidDepthChart', () => {
    render(createElement(DepthChartWidget, makeWidgetProps()));
    expect(screen.getByTestId('depth-chart').textContent).toBe('b:3 s:50000 c:25000');
  });
});
