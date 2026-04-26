import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

import { MatchedJobCard } from '@/components/jobs/MatchedJobCard';
import type { Job } from '@/types';
import { AUCTION_TYPE, JOB_STATUS, SCHEDULE_TYPE } from '@/types';

const mockJob: Job = {
  id: 'job-42',
  customer_id: 'cust-1',
  category_id: 'cat-1',
  category_name: 'Plumbing',
  category_slug: 'plumbing',
  title: 'Replace bathroom faucet',
  description: 'Standard install',
  status: JOB_STATUS.ACTIVE,
  schedule_type: SCHEDULE_TYPE.FLEXIBLE,
  scheduled_date: null,
  is_recurring: false,
  recurrence_frequency: null,
  location_address: '123 Main St',
  location_lat: 40,
  location_lng: -75,
  starting_bid_cents: 20000,
  offer_accepted_cents: null,
  auction_duration_hours: 24,
  auction_ends_at: new Date(Date.now() + 3600_000).toISOString(),
  bid_count: 0,
  lowest_bid_cents: null,
  market_range: null,
  auction_type: AUCTION_TYPE.LIVE,
  snipe_extension_count: 0,
  original_auction_ends_at: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

describe('MatchedJobCard', () => {
  it('shows the job title and category', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={80} distanceKm={2.5} />);
    expect(screen.getByText('Replace bathroom faucet')).toBeDefined();
    expect(screen.getByText('Plumbing')).toBeDefined();
  });

  it('renders distance in km when over 1km', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={80} distanceKm={2.5} />);
    expect(screen.getByText('2.5km away')).toBeDefined();
  });

  it('renders distance in meters under 1km', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={80} distanceKm={0.4} />);
    expect(screen.getByText('400m away')).toBeDefined();
  });

  it('renders match label and score', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={92} distanceKm={3} />);
    expect(screen.getByText('Excellent Match')).toBeDefined();
    expect(screen.getByText('92%')).toBeDefined();
  });

  it('renders Bid Now CTA linking to bid page', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={80} distanceKm={3} />);
    const cta = screen.getByText('Bid Now').closest('a');
    expect(cta?.getAttribute('href')).toBe('/jobs/job-42/bid');
  });

  it('renders budget when starting_bid_cents is present', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={80} distanceKm={3} />);
    expect(screen.getByText(/Up to/)).toBeDefined();
  });

  it('renders distance in rounded km when over 10km', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={80} distanceKm={12.7} />);
    expect(screen.getByText('13km away')).toBeDefined();
  });

  it('shows the accepted offer amount when offer_accepted_cents is present', () => {
    render(
      <MatchedJobCard
        job={{ ...mockJob, offer_accepted_cents: 15000, starting_bid_cents: null }}
        matchScorePct={80}
        distanceKm={2}
      />,
    );
    expect(screen.getByText('$150.00')).toBeDefined();
  });

  it('hides budget row when both starting and offer cents are null', () => {
    render(
      <MatchedJobCard
        job={{ ...mockJob, starting_bid_cents: null, offer_accepted_cents: null }}
        matchScorePct={80}
        distanceKm={2}
      />,
    );
    expect(screen.queryByText('Budget:')).toBeNull();
  });

  it('renders the Recurring badge with the frequency', () => {
    render(
      <MatchedJobCard
        job={{ ...mockJob, is_recurring: true, recurrence_frequency: 'weekly' }}
        matchScorePct={80}
        distanceKm={2}
      />,
    );
    expect(screen.getByText(/Recurring \(weekly\)/)).toBeDefined();
  });

  it('renders Strong Match label for scores 75-89', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={80} distanceKm={2} />);
    expect(screen.getByText('Strong Match')).toBeDefined();
  });

  it('renders Good Match label for scores 60-74', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={65} distanceKm={2} />);
    expect(screen.getByText('Good Match')).toBeDefined();
  });

  it('renders generic Match label for scores below 60', () => {
    render(<MatchedJobCard job={mockJob} matchScorePct={45} distanceKm={2} />);
    expect(screen.getByText('Match')).toBeDefined();
  });

  it('omits the auction timer block when auction_ends_at is null', () => {
    const { container } = render(
      <MatchedJobCard
        job={{ ...mockJob, auction_ends_at: null }}
        matchScorePct={80}
        distanceKm={2}
      />,
    );
    // No border-t pt-3 timer wrapper means no AuctionTimer label
    expect(container.textContent).not.toContain('Time left');
  });
});
