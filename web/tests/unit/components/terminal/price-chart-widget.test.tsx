// PriceChartWidget — wrapper around PriceDropChart. Mock the chart and
// assert the title plus event forwarding.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/bids/PriceDropChart', () => ({
  PriceDropChart: ({ events }: { events: unknown[] }) =>
    createElement('div', { 'data-testid': 'price-drop-chart' }, `events:${String(events.length)}`),
}));

import { PriceChartWidget } from '@/components/terminal/widgets/price-chart-widget';
import { makeWidgetProps, makeSim } from './_fixtures';
import type { AuctionBidEvent } from '@/types';

describe('PriceChartWidget', () => {
  it('renders Price History header', () => {
    render(createElement(PriceChartWidget, makeWidgetProps()));
    expect(screen.getByText('Price History')).toBeDefined();
  });

  it('forwards events to PriceDropChart', () => {
    const events: AuctionBidEvent[] = [
      { job_id: 'j', amount_cents: 1000, event_type: 'bid_placed', created_at: '2026-04-01' },
      { job_id: 'j', amount_cents: 900, event_type: 'bid_placed', created_at: '2026-04-02' },
    ];
    render(createElement(PriceChartWidget, makeWidgetProps({ sim: makeSim({ events }) })));
    expect(screen.getByTestId('price-drop-chart').textContent).toBe('events:2');
  });
});
