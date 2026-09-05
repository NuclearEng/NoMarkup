import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UrgencyStrip } from '@/components/marketplace/UrgencyStrip';

describe('UrgencyStrip', () => {
  it('shows the empty headline when no auctions are closing soon', () => {
    render(<UrgencyStrip closingSoonCount={0} totalWatchers={0} liveBidsCount={0} />);
    expect(screen.getByText(/No auctions closing in the next hour/)).toBeDefined();
  });

  it('pluralizes correctly with multiple auctions', () => {
    render(<UrgencyStrip closingSoonCount={7} totalWatchers={132} liveBidsCount={48} />);
    expect(screen.getByText(/7 auctions closing in the next hour/)).toBeDefined();
  });

  it('uses singular form for exactly one auction', () => {
    render(<UrgencyStrip closingSoonCount={1} totalWatchers={5} liveBidsCount={2} />);
    expect(screen.getByText(/1 auction closing in the next hour/)).toBeDefined();
  });

  it('renders all three KPI tiles with their values', () => {
    render(<UrgencyStrip closingSoonCount={4} totalWatchers={87} liveBidsCount={31} />);
    expect(screen.getByText('4')).toBeDefined();
    expect(screen.getByText('87')).toBeDefined();
    expect(screen.getByText('31')).toBeDefined();
  });
});
