// SavingsWidget — thin wrapper around SavingsHero. Mock the hero so we can
// assert that the wrapper renders it for valid bid data and shows a placeholder
// otherwise.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/bids/SavingsHero', () => ({
  SavingsHero: ({
    startingPriceCents,
    currentLowestCents,
  }: {
    startingPriceCents: number;
    currentLowestCents: number;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'savings-hero' },
      `start:${String(startingPriceCents)} now:${String(currentLowestCents)}`,
    ),
}));

import { SavingsWidget } from '@/components/terminal/widgets/savings-widget';
import { makeWidgetProps, makeSim } from './_fixtures';

describe('SavingsWidget', () => {
  it('renders SavingsHero when there is real savings', () => {
    render(createElement(SavingsWidget, makeWidgetProps()));
    expect(screen.getByTestId('savings-hero').textContent).toBe('start:50000 now:25000');
  });

  it('shows waiting state when no current bid', () => {
    render(createElement(SavingsWidget, makeWidgetProps({ sim: makeSim({ currentLowest: 0 }) })));
    expect(screen.getByText(/Waiting for bids/)).toBeDefined();
    expect(screen.queryByTestId('savings-hero')).toBeNull();
  });

  it('shows waiting state when current bid >= starting price', () => {
    render(
      createElement(
        SavingsWidget,
        makeWidgetProps({ sim: makeSim({ currentLowest: 60000 }), startingPriceCents: 50000 }),
      ),
    );
    expect(screen.getByText(/Waiting for bids/)).toBeDefined();
  });
});
