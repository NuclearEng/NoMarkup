import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

vi.mock('@/hooks/useAnalytics', () => ({
  useMarketRange: vi.fn(() => ({ data: undefined })),
}));

import { JobCard } from '@/components/jobs/JobCard';
import type { Job } from '@/types';
import { AUCTION_TYPE, JOB_STATUS, SCHEDULE_TYPE } from '@/types';

const mockJob: Job = {
  id: 'job-1',
  customer_id: 'cust-1',
  category_id: 'cat-1',
  category_name: 'Plumbing',
  category_slug: 'plumbing',
  title: 'Fix kitchen sink leak',
  description: 'Slow drip under the sink that needs fixing.',
  status: JOB_STATUS.ACTIVE,
  schedule_type: SCHEDULE_TYPE.FLEXIBLE,
  scheduled_date: null,
  is_recurring: false,
  recurrence_frequency: null,
  location_address: '123 Main St, Springfield',
  location_lat: 40.7128,
  location_lng: -74.006,
  starting_bid_cents: 10000,
  offer_accepted_cents: null,
  auction_duration_hours: 48,
  auction_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
  bid_count: 3,
  lowest_bid_cents: 8500,
  market_range: null,
  auction_type: AUCTION_TYPE.LIVE,
  snipe_extension_count: 0,
  original_auction_ends_at: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

describe('JobCard', () => {
  it('renders the job title', () => {
    render(<JobCard job={mockJob} />);
    expect(screen.getByText('Fix kitchen sink leak')).toBeDefined();
  });

  it('renders the category name', () => {
    render(<JobCard job={mockJob} />);
    expect(screen.getByText('Plumbing')).toBeDefined();
  });

  it('renders location address', () => {
    render(<JobCard job={mockJob} />);
    expect(screen.getByText('123 Main St, Springfield')).toBeDefined();
  });

  it('renders bid count text', () => {
    render(<JobCard job={mockJob} />);
    // bid_count = 3 → "3 bids"
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('bids')).toBeDefined();
  });

  it('renders the lowest bid prominently', () => {
    render(<JobCard job={mockJob} />);
    expect(screen.getByText('Lowest:')).toBeDefined();
    expect(screen.getByText('$85.00')).toBeDefined();
  });

  it('renders the status badge', () => {
    render(<JobCard job={mockJob} />);
    expect(screen.getByText('active')).toBeDefined();
  });

  it('links to the job detail page', () => {
    render(<JobCard job={mockJob} />);
    const link = screen.getByText('Fix kitchen sink leak').closest('a');
    expect(link?.getAttribute('href')).toBe('/jobs/job-1');
  });

  it('shows the Flexible Schedule label when schedule_type is flexible', () => {
    render(<JobCard job={mockJob} />);
    expect(screen.getByText('Flexible Schedule')).toBeDefined();
  });

  it('renders a formatted date when schedule_type is specific_date', () => {
    render(
      <JobCard
        job={{
          ...mockJob,
          schedule_type: SCHEDULE_TYPE.SPECIFIC_DATE,
          scheduled_date: '2026-08-15T00:00:00Z',
        }}
      />,
    );
    // toLocaleDateString → "Aug 15, 2026" (en-US)
    expect(screen.getByText(/Aug 1[45], 2026/)).toBeDefined();
  });

  it('renders the Recurring badge when is_recurring is true', () => {
    render(<JobCard job={{ ...mockJob, is_recurring: true }} />);
    expect(screen.getByText('Recurring')).toBeDefined();
  });

  it('falls back to Uncategorized when category_name is empty', () => {
    render(<JobCard job={{ ...mockJob, category_name: '' }} />);
    expect(screen.getByText('Uncategorized')).toBeDefined();
  });

  it('hides location row when location_address is missing', () => {
    render(<JobCard job={{ ...mockJob, location_address: '' }} />);
    expect(screen.queryByText('123 Main St, Springfield')).toBeNull();
  });

  it('renders "No auction" when auction_ends_at is null', () => {
    render(
      <JobCard
        job={{
          ...mockJob,
          auction_ends_at: null,
          status: JOB_STATUS.COMPLETED,
        }}
      />,
    );
    expect(screen.getByText('No auction')).toBeDefined();
    // No progress bar without auction
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders an auction progress bar when an auction is in flight', () => {
    // Auction started ~24h ago, ends in 24h, duration 48h → ~50% elapsed
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    render(
      <JobCard
        job={{
          ...mockJob,
          auction_ends_at: endsAt,
          auction_duration_hours: 48,
        }}
      />,
    );
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('renders draft, awarded, in-progress, completed, suspended, cancelled status badges', () => {
    const statuses = [
      JOB_STATUS.DRAFT,
      JOB_STATUS.AWARDED,
      JOB_STATUS.IN_PROGRESS,
      JOB_STATUS.COMPLETED,
      JOB_STATUS.SUSPENDED,
      JOB_STATUS.CANCELLED,
    ];
    for (const status of statuses) {
      const { unmount, getByText } = render(<JobCard job={{ ...mockJob, status }} />);
      expect(getByText(status.replace(/_/g, ' '))).toBeDefined();
      unmount();
    }
  });

  it('renders "1 bid" (singular) when there is exactly one bid', () => {
    render(<JobCard job={{ ...mockJob, bid_count: 1 }} />);
    expect(screen.getByText('bid')).toBeDefined();
  });
});
