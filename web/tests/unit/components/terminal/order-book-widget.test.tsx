// OrderBookWidget — wrapper around OrderBook. We mock OrderBook to assert
// the widget forwards bids and starting price.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/bids/OrderBook', () => ({
  OrderBook: ({
    bids,
    startingPrice,
  }: {
    bids: { id: string }[];
    startingPrice: number;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'order-book' },
      `count:${String(bids.length)} start:${String(startingPrice)}`,
    ),
}));

import { OrderBookWidget } from '@/components/terminal/widgets/order-book-widget';
import { makeWidgetProps, makeSim } from './_fixtures';

describe('OrderBookWidget', () => {
  it('forwards bid count and starting price to OrderBook', () => {
    render(createElement(OrderBookWidget, makeWidgetProps()));
    expect(screen.getByTestId('order-book').textContent).toBe('count:3 start:50000');
  });

  it('renders with empty bid list', () => {
    render(
      createElement(OrderBookWidget, makeWidgetProps({ sim: makeSim({ orderBookBids: [] }) })),
    );
    expect(screen.getByTestId('order-book').textContent).toBe('count:0 start:50000');
  });
});
