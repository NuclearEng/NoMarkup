import { render, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { OrderBook } from '@/components/bids/OrderBook';
import { TooltipProvider } from '@/components/ui/tooltip';

function withTooltipProvider(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const baseBid = (over: Partial<Parameters<typeof OrderBook>[0]['bids'][number]>) => ({
  id: 'b1',
  provider_name: 'Acme',
  amount_cents: 25000,
  trust_score: 85,
  trust_tier: 'trusted',
  created_at: new Date().toISOString(),
  ...over,
});

describe('OrderBook', () => {
  it('shows empty state when there are no bids', () => {
    render(<OrderBook jobId="job-1" bids={[]} startingPrice={50000} />);
    expect(screen.getByText(/no bids yet/i)).toBeDefined();
  });

  it('renders the order book heading and bid count', () => {
    withTooltipProvider(
      <OrderBook
        jobId="job-1"
        bids={[baseBid({ id: 'b1' }), baseBid({ id: 'b2', amount_cents: 30000 })]}
        startingPrice={50000}
      />,
    );
    expect(screen.getByText('Order Book')).toBeDefined();
    expect(screen.getByText('2 bids')).toBeDefined();
  });

  it('sorts bids ascending by price (lowest first)', () => {
    withTooltipProvider(
      <OrderBook
        jobId="job-1"
        bids={[
          baseBid({ id: 'high', provider_name: 'Higher Co', amount_cents: 30000 }),
          baseBid({ id: 'low', provider_name: 'Lower Co', amount_cents: 18000 }),
          baseBid({ id: 'mid', provider_name: 'Middle Co', amount_cents: 24000 }),
        ]}
        startingPrice={50000}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    // Lowest must be first
    expect(rows[0]?.getAttribute('aria-label')).toContain('Lower Co');
    expect(rows[0]?.getAttribute('aria-label')).toContain('current lowest bid');
    expect(rows[2]?.getAttribute('aria-label')).toContain('Higher Co');
  });

  it('renders provider names and prices', () => {
    withTooltipProvider(
      <OrderBook
        jobId="job-1"
        bids={[
          baseBid({ id: 'a', provider_name: 'Acme Plumbing', amount_cents: 15000 }),
          baseBid({ id: 'b', provider_name: 'Beta Pipes', amount_cents: 20000 }),
        ]}
        startingPrice={50000}
      />,
    );
    expect(screen.getByText('Acme Plumbing')).toBeDefined();
    expect(screen.getByText('Beta Pipes')).toBeDefined();
    expect(screen.getByText('$150')).toBeDefined();
    expect(screen.getByText('$200')).toBeDefined();
  });
});
