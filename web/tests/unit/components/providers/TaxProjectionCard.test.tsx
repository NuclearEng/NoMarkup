import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TaxProjectionCard } from '@/components/providers/TaxProjectionCard';

describe('TaxProjectionCard', () => {
  it('renders the tax year in the heading', () => {
    render(<TaxProjectionCard ytdEarningsCents={120000} taxYear={2026} />);
    expect(screen.getByText(/Tax Projection 2026/)).toBeDefined();
  });

  it('renders quarterly breakdown labels Q1-Q4', () => {
    render(<TaxProjectionCard ytdEarningsCents={500000} taxYear={2026} />);
    expect(screen.getByText('Q1')).toBeDefined();
    expect(screen.getByText('Q2')).toBeDefined();
    expect(screen.getByText('Q3')).toBeDefined();
    expect(screen.getByText('Q4')).toBeDefined();
  });

  it('shows YTD earnings text', () => {
    render(<TaxProjectionCard ytdEarningsCents={250000} taxYear={2026} />);
    // formatted as $2,500.00 in body text
    expect(screen.getByText(/Based on/)).toBeDefined();
  });

  it('displays disclaimer text', () => {
    render(<TaxProjectionCard ytdEarningsCents={100000} taxYear={2026} />);
    expect(
      screen.getByText(/Consult a tax professional/i),
    ).toBeDefined();
  });
});
