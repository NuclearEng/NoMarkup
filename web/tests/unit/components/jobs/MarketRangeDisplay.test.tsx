import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MarketRange } from '@/types';

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const baseRange: MarketRange = {
  low_cents: 5000,
  median_cents: 10000,
  high_cents: 15000,
  sample_size: 25,
};

describe('MarketRangeDisplay', () => {
  it('renders the full variant header', () => {
    renderWithTooltip(<MarketRangeDisplay marketRange={baseRange} />);
    expect(screen.getByText('Market Intelligence')).toBeDefined();
  });

  it('renders the compact variant header', () => {
    renderWithTooltip(<MarketRangeDisplay marketRange={baseRange} compact />);
    expect(screen.getByText('Market Intel')).toBeDefined();
  });

  it('shows formatted low and high prices', () => {
    renderWithTooltip(<MarketRangeDisplay marketRange={baseRange} />);
    expect(screen.getByText('$50.00')).toBeDefined();
    expect(screen.getByText('$150.00')).toBeDefined();
  });

  it('reports a savings callout when current bid is below median', () => {
    renderWithTooltip(<MarketRangeDisplay marketRange={baseRange} currentBidCents={7500} />);
    expect(screen.getByText(/below market/)).toBeDefined();
  });

  it('reports an over-market callout when current bid is above median', () => {
    renderWithTooltip(<MarketRangeDisplay marketRange={baseRange} currentBidCents={13000} />);
    expect(screen.getByText(/above market/)).toBeDefined();
  });

  it('labels confidence based on sample size', () => {
    const limited: MarketRange = { ...baseRange, sample_size: 2 };
    renderWithTooltip(<MarketRangeDisplay marketRange={limited} compact />);
    expect(screen.getByText('Limited data')).toBeDefined();
  });

  it('marks high confidence with 20+ samples', () => {
    renderWithTooltip(<MarketRangeDisplay marketRange={baseRange} />);
    expect(screen.getAllByText(/High confidence/).length).toBeGreaterThan(0);
  });
});
