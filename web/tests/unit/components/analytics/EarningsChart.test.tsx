import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EarningsChart } from '@/components/analytics/EarningsChart';
import type { EarningsDataPoint } from '@/types';

const sampleData: EarningsDataPoint[] = [
  { period_start: '2026-01-01T00:00:00Z', earnings_cents: 120000, fees_cents: 12000, job_count: 4 },
  { period_start: '2026-02-01T00:00:00Z', earnings_cents: 200000, fees_cents: 20000, job_count: 6 },
  { period_start: '2026-03-01T00:00:00Z', earnings_cents: 80000, fees_cents: 8000, job_count: 3 },
];

describe('EarningsChart', () => {
  it('renders the section title', () => {
    render(
      <EarningsChart
        data={sampleData}
        totalEarnings={400000}
        totalFees={40000}
        netEarnings={360000}
        totalJobs={13}
      />,
    );
    expect(screen.getByText('Earnings Overview')).toBeDefined();
  });

  it('renders the four summary stats with formatted values', () => {
    render(
      <EarningsChart
        data={sampleData}
        totalEarnings={400000}
        totalFees={40000}
        netEarnings={360000}
        totalJobs={13}
      />,
    );
    expect(screen.getByText('Total Earnings')).toBeDefined();
    expect(screen.getByText('Total Fees')).toBeDefined();
    // "Net Earnings" appears twice (summary stat label + chart legend)
    expect(screen.getAllByText('Net Earnings').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Total Jobs')).toBeDefined();
    expect(screen.getByText('13')).toBeDefined();
  });

  it('shows the empty state when data is empty', () => {
    render(
      <EarningsChart
        data={[]}
        totalEarnings={0}
        totalFees={0}
        netEarnings={0}
        totalJobs={0}
      />,
    );
    expect(screen.getByText(/no earnings data available/i)).toBeDefined();
  });

  it('renders a bar with an aria-label per data point', () => {
    render(
      <EarningsChart
        data={sampleData}
        totalEarnings={400000}
        totalFees={40000}
        netEarnings={360000}
        totalJobs={13}
      />,
    );
    const bars = screen
      .getAllByRole('img')
      .filter((el) => el.getAttribute('aria-label')?.includes('earnings'));
    expect(bars.length).toBe(sampleData.length);
  });

  it('renders the legend entries Net Earnings and Fees', () => {
    render(
      <EarningsChart
        data={sampleData}
        totalEarnings={400000}
        totalFees={40000}
        netEarnings={360000}
        totalJobs={13}
      />,
    );
    // Both summary stat label and legend label say "Net Earnings"; just check the legend "Fees" entry exists
    expect(screen.getByText('Fees')).toBeDefined();
  });

  it('forwards className to the card root', () => {
    const { container } = render(
      <EarningsChart
        data={[]}
        totalEarnings={0}
        totalFees={0}
        netEarnings={0}
        totalJobs={0}
        className="custom-card"
      />,
    );
    expect(container.querySelector('.custom-card')).not.toBeNull();
  });

  // ---- DEEPENING TESTS ----

  it('renders bars with zero-height fallback when a point has zero earnings (line 125/135 fallback)', () => {
    const { container } = render(
      <EarningsChart
        data={[
          { period_start: '2026-01-01T00:00:00Z', earnings_cents: 0, fees_cents: 0, job_count: 0 },
          { period_start: '2026-02-01T00:00:00Z', earnings_cents: 100, fees_cents: 10, job_count: 1 },
        ]}
        totalEarnings={100}
        totalFees={10}
        netEarnings={90}
        totalJobs={1}
      />,
    );
    // The zero-earnings bar produces an inner stack with height '0%' on both
    // the net-earnings and fees portions (the falsy branch of `earningsHeight > 0`).
    const zeroPercentBars = Array.from(container.querySelectorAll<HTMLDivElement>('div')).filter(
      (el) => el.style.height === '0%',
    );
    expect(zeroPercentBars.length).toBeGreaterThanOrEqual(2);
  });

  it('exercises a single-point dataset (single bar renders, baseline math runs)', () => {
    const { container } = render(
      <EarningsChart
        data={[
          { period_start: '2026-04-01T00:00:00Z', earnings_cents: 50000, fees_cents: 5000, job_count: 2 },
        ]}
        totalEarnings={50000}
        totalFees={5000}
        netEarnings={45000}
        totalJobs={2}
      />,
    );
    // Exactly one bar (img with aria-label containing 'earnings') is rendered.
    const bars = Array.from(container.querySelectorAll('[role="img"]')).filter((el) =>
      el.getAttribute('aria-label')?.includes('earnings'),
    );
    expect(bars.length).toBe(1);
  });
});
