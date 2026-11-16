import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Stub all 12 underlying widget modules with simple data-testid markers so we can assert
// dispatching by widget id without bringing in their full dependency trees.
vi.mock('@/components/terminal/widgets/price-hero-widget', () => ({
  PriceHeroWidget: () => createElement('div', { 'data-testid': 'w-price-hero' }),
}));
vi.mock('@/components/terminal/widgets/savings-widget', () => ({
  SavingsWidget: () => createElement('div', { 'data-testid': 'w-savings' }),
}));
vi.mock('@/components/terminal/widgets/order-book-widget', () => ({
  OrderBookWidget: () => createElement('div', { 'data-testid': 'w-order-book' }),
}));
vi.mock('@/components/terminal/widgets/price-chart-widget', () => ({
  PriceChartWidget: () => createElement('div', { 'data-testid': 'w-price-chart' }),
}));
vi.mock('@/components/terminal/widgets/depth-chart-widget', () => ({
  DepthChartWidget: () => createElement('div', { 'data-testid': 'w-depth-chart' }),
}));
vi.mock('@/components/terminal/widgets/bid-trend-widget', () => ({
  BidTrendWidget: () => createElement('div', { 'data-testid': 'w-bid-trend' }),
}));
vi.mock('@/components/terminal/widgets/activity-feed-widget', () => ({
  ActivityFeedWidget: () => createElement('div', { 'data-testid': 'w-activity-feed' }),
}));
vi.mock('@/components/terminal/widgets/top-providers-widget', () => ({
  TopProvidersWidget: () => createElement('div', { 'data-testid': 'w-top-providers' }),
}));
vi.mock('@/components/terminal/widgets/market-intel-widget', () => ({
  MarketIntelWidget: () => createElement('div', { 'data-testid': 'w-market-intel' }),
}));
vi.mock('@/components/terminal/widgets/velocity-widget', () => ({
  VelocityWidget: () => createElement('div', { 'data-testid': 'w-velocity' }),
}));
vi.mock('@/components/terminal/widgets/social-proof-widget', () => ({
  SocialProofWidget: () => createElement('div', { 'data-testid': 'w-social-proof' }),
}));
vi.mock('@/components/terminal/widgets/job-details-widget', () => ({
  JobDetailsWidget: () => createElement('div', { 'data-testid': 'w-job-details' }),
}));

import { WidgetRenderer } from '@/components/terminal/widget-renderer';
import type { WidgetProps } from '@/components/terminal/types';

const stubProps = {} as unknown as WidgetProps;

describe('WidgetRenderer', () => {
  it.each([
    ['price-hero', 'w-price-hero'],
    ['savings', 'w-savings'],
    ['order-book', 'w-order-book'],
    ['price-chart', 'w-price-chart'],
    ['depth-chart', 'w-depth-chart'],
    ['bid-trend', 'w-bid-trend'],
    ['activity-feed', 'w-activity-feed'],
    ['top-providers', 'w-top-providers'],
    ['market-intel', 'w-market-intel'],
    ['velocity', 'w-velocity'],
    ['social-proof', 'w-social-proof'],
    ['job-details', 'w-job-details'],
  ])('renders widget %s by id', (id, testId) => {
    render(createElement(WidgetRenderer, { widgetId: id, widgetProps: stubProps }));
    expect(screen.getByTestId(testId)).toBeDefined();
  });

  it('renders unknown widget fallback', () => {
    render(createElement(WidgetRenderer, { widgetId: 'not-a-real-widget', widgetProps: stubProps }));
    expect(screen.getByText(/Unknown widget: not-a-real-widget/)).toBeDefined();
  });
});
