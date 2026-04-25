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
});
