// MarketIntelWidget — wrapper around MarketRangeDisplay.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/jobs/MarketRangeDisplay', () => ({
  MarketRangeDisplay: ({
    marketRange,
    currentBidCents,
  }: {
    marketRange: { low_cents: number; median_cents: number; high_cents: number };
    currentBidCents: number | undefined;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'market-range' },
      `low:${String(marketRange.low_cents)} med:${String(marketRange.median_cents)} cur:${String(currentBidCents ?? 'none')}`,
    ),
}));

import { MarketIntelWidget } from '@/components/terminal/widgets/market-intel-widget';
import { makeWidgetProps, makeSim } from './_fixtures';

describe('MarketIntelWidget', () => {
  it('forwards market range and current bid', () => {
    render(createElement(MarketIntelWidget, makeWidgetProps()));
    expect(screen.getByTestId('market-range').textContent).toBe(
      'low:22000 med:28000 cur:25000',
    );
  });

  it('passes undefined when no current bid', () => {
    render(
      createElement(MarketIntelWidget, makeWidgetProps({ sim: makeSim({ currentLowest: 0 }) })),
    );
    expect(screen.getByTestId('market-range').textContent).toBe(
      'low:22000 med:28000 cur:none',
    );
  });
});
