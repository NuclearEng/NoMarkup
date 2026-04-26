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

  it('marks moderate confidence with 5-19 samples', () => {
    const moderate: MarketRange = { ...baseRange, sample_size: 10 };
    renderWithTooltip(<MarketRangeDisplay marketRange={moderate} compact />);
    expect(screen.getByText('Moderate confidence')).toBeDefined();
  });

  it('marks moderate confidence with 5-19 samples in full variant', () => {
    const moderate: MarketRange = { ...baseRange, sample_size: 10 };
    renderWithTooltip(<MarketRangeDisplay marketRange={moderate} />);
    expect(screen.getAllByText('Moderate confidence').length).toBeGreaterThan(0);
  });

  it('handles a sample size of 1 with the singular "job" label', () => {
    const single: MarketRange = { ...baseRange, sample_size: 1 };
    renderWithTooltip(<MarketRangeDisplay marketRange={single} />);
    expect(screen.getAllByText(/1 job/).length).toBeGreaterThan(0);
  });

  it('renders a compact callout when bid is above market', () => {
    renderWithTooltip(
      <MarketRangeDisplay marketRange={baseRange} currentBidCents={13000} compact />,
    );
    expect(screen.getByText(/% above market/)).toBeDefined();
  });

  it('renders a compact callout when bid is below market', () => {
    renderWithTooltip(
      <MarketRangeDisplay marketRange={baseRange} currentBidCents={7500} compact />,
    );
    expect(screen.getByText(/% below market/)).toBeDefined();
  });

  it('renders bid label in full variant when current bid provided', () => {
    renderWithTooltip(<MarketRangeDisplay marketRange={baseRange} currentBidCents={7500} />);
    // The current bid is shown as a formatted price label above the bar
    expect(screen.getAllByText(/\$75\.00/).length).toBeGreaterThan(0);
  });

  it('renders without a savings callout when bid equals median', () => {
    renderWithTooltip(<MarketRangeDisplay marketRange={baseRange} currentBidCents={10000} />);
    expect(screen.queryByText(/% below market/)).toBeNull();
    expect(screen.queryByText(/% above market/)).toBeNull();
  });

  it('handles a degenerate range (low === high) without crashing', () => {
    const flat: MarketRange = { low_cents: 10000, median_cents: 10000, high_cents: 10000, sample_size: 25 };
    renderWithTooltip(<MarketRangeDisplay marketRange={flat} currentBidCents={9000} />);
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
  });
});
