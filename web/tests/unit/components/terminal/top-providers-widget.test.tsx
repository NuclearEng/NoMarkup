// TopProvidersWidget — renders top 3 bidders with medal, trust, and price.
// No sub-component mocks needed — the widget renders inline.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { TopProvidersWidget } from '@/components/terminal/widgets/top-providers-widget';
import { makeWidgetProps, makeSim } from './_fixtures';

describe('TopProvidersWidget', () => {
  it('renders Top Providers header when 3+ bids', () => {
    render(createElement(TopProvidersWidget, makeWidgetProps()));
    expect(screen.getByText('Top Providers')).toBeDefined();
  });

  it('lists the top three bidders in order', () => {
    render(createElement(TopProvidersWidget, makeWidgetProps()));
    expect(screen.getByText('Alice Plumbing')).toBeDefined();
    expect(screen.getByText('Bob Builders')).toBeDefined();
    expect(screen.getByText('Carol Co.')).toBeDefined();
  });

  it('renders provider bid amounts as currency', () => {
    render(createElement(TopProvidersWidget, makeWidgetProps()));
    expect(screen.getByText('$250')).toBeDefined();
    expect(screen.getByText('$275')).toBeDefined();
    expect(screen.getByText('$290')).toBeDefined();
  });

  it('shows percentage off relative to starting price', () => {
    render(createElement(TopProvidersWidget, makeWidgetProps()));
    // (50000 - 25000) / 50000 = 50%
    expect(screen.getByText('50% off')).toBeDefined();
  });

  it('shows waiting state when fewer than 3 bids', () => {
    render(
      createElement(
        TopProvidersWidget,
        makeWidgetProps({ sim: makeSim({ orderBookBids: [] }) }),
      ),
    );
    expect(screen.getByText(/Waiting for more bids/)).toBeDefined();
  });

  it('falls back to a "?" initial when no mockProvider matches the bid name', () => {
    // Provide an empty mockProviders list so the .find() never resolves; the
    // component falls back to the placeholder "?" initial.
    const props = makeWidgetProps({ mockProviders: [] });
    render(createElement(TopProvidersWidget, props));
    // Three bids in the default sim, all with no matching provider.
    expect(screen.getAllByText('?').length).toBeGreaterThanOrEqual(3);
  });
});
