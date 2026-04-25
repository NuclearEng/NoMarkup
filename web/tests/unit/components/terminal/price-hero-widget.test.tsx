// PriceHeroWidget — mostly presentational. We mock heavy children
// (AnimatedPrice, BidVelocityIndicator, SnipeIndicator, AuctionTimer) so the
// test asserts the widget composes the price, savings, and bid count.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/bids/AnimatedPrice', () => ({
  AnimatedPrice: ({ cents, formatCurrency }: { cents: number; formatCurrency: (c: number) => string }) =>
    createElement('span', { 'data-testid': 'animated-price' }, formatCurrency(cents)),
}));
vi.mock('@/components/bids/BidVelocityIndicator', () => ({
  BidVelocityIndicator: () => createElement('span', { 'data-testid': 'velocity-indicator' }),
}));
vi.mock('@/components/bids/SnipeIndicator', () => ({
  SnipeIndicator: ({ count, max }: { count: number; max: number }) =>
    createElement('span', { 'data-testid': 'snipe-indicator' }, `${String(count)}/${String(max)}`),
}));
vi.mock('@/components/jobs/AuctionTimer', () => ({
  AuctionTimer: () => createElement('span', { 'data-testid': 'auction-timer' }, '1h'),
}));

import { PriceHeroWidget } from '@/components/terminal/widgets/price-hero-widget';
import { makeWidgetProps, makeSim } from './_fixtures';

describe('PriceHeroWidget', () => {
  it('renders current lowest bid as formatted currency', () => {
    render(createElement(PriceHeroWidget, makeWidgetProps()));
    expect(screen.getByText('Current Lowest Bid')).toBeDefined();
    expect(screen.getByTestId('animated-price').textContent).toBe('$250');
  });

  it('renders bid count and label', () => {
    render(createElement(PriceHeroWidget, makeWidgetProps()));
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('Bids')).toBeDefined();
  });

  it('renders savings badge when current is below starting', () => {
    render(createElement(PriceHeroWidget, makeWidgetProps()));
    // 50000 - 25000 = 25000 (50% off)
    expect(screen.getByText(/Save \$250 \(50%\)/)).toBeDefined();
  });

  it('shows LIVE indicator when isRunning', () => {
    render(createElement(PriceHeroWidget, makeWidgetProps({ sim: makeSim({ isRunning: true }) })));
    expect(screen.getByText('LIVE')).toBeDefined();
  });

  it('hides LIVE indicator when not running', () => {
    render(createElement(PriceHeroWidget, makeWidgetProps({ sim: makeSim({ isRunning: false }) })));
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('shows Waiting placeholder when no current bid', () => {
    render(createElement(PriceHeroWidget, makeWidgetProps({ sim: makeSim({ currentLowest: 0 }) })));
    expect(screen.getByText(/Waiting/)).toBeDefined();
  });
});
