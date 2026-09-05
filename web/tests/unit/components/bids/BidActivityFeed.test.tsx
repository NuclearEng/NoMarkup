import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BidActivityFeed } from '@/components/bids/BidActivityFeed';

describe('BidActivityFeed', () => {
  it('shows empty state when there are no activities', () => {
    render(<BidActivityFeed activities={[]} />);
    expect(screen.getByText(/no bids yet/i)).toBeDefined();
  });

  it('renders one row per activity with provider name and price', () => {
    render(
      <BidActivityFeed
        activities={[
          {
            id: '1',
            providerName: 'Acme Plumbing',
            amount: 25000,
            timestamp: '2 mins ago',
            isLowest: true,
          },
          {
            id: '2',
            providerName: 'Pipe Wizards',
            amount: 27550,
            timestamp: '4 mins ago',
          },
        ]}
      />,
    );
    expect(screen.getByText('Acme Plumbing')).toBeDefined();
    expect(screen.getByText('Pipe Wizards')).toBeDefined();
    expect(screen.getByText('$250')).toBeDefined();
    expect(screen.getByText('$275.50')).toBeDefined();
    expect(screen.getByText('Lowest')).toBeDefined();
  });

  it('shows the live header by default', () => {
    render(
      <BidActivityFeed
        activities={[{ id: '1', providerName: 'X', amount: 1000, timestamp: 'now' }]}
      />,
    );
    expect(screen.getByText(/live activity/i)).toBeDefined();
  });

  it('hides the header when showHeader is false', () => {
    render(
      <BidActivityFeed
        showHeader={false}
        activities={[{ id: '1', providerName: 'X', amount: 1000, timestamp: 'now' }]}
      />,
    );
    expect(screen.queryByText(/live activity/i)).toBeNull();
  });

  it('exposes the feed as a log region', () => {
    render(
      <BidActivityFeed
        activities={[{ id: '1', providerName: 'X', amount: 1000, timestamp: 'now' }]}
      />,
    );
    expect(screen.getByRole('log')).toBeDefined();
  });
});
