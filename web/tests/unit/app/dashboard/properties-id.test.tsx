import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const property = {
  id: 'p1',
  nickname: 'Lake House',
  address: { street: '123 Lakefront Rd', city: 'Bellevue', state: 'WA', zip_code: '98004' },
  notes: 'Gate code 1234',
  active_jobs: 1,
  total_spend_cents: 10000,
  created_at: '2026-01-01T00:00:00Z',
};

const propertiesState = {
  data: [property] as unknown[] | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const preferredState = {
  data: {
    preferred_threshold: 3,
    providers: [
      {
        provider_id: 'pr-1',
        display_name: 'Ace Plumbing',
        completed_count: 3,
        last_completed_at: null,
        is_preferred: true,
      },
    ],
  } as unknown,
  isLoading: false,
  isError: false,
};

const jobsState = {
  data: {
    jobs: [
      {
        id: 'j-active',
        customer_id: 'c1',
        category_id: 'cat-plumb',
        category_name: 'Plumbing',
        category_slug: 'plumbing',
        title: 'Fix pipe',
        description: 'A'.repeat(50),
        status: 'active',
        schedule_type: 'flexible',
        scheduled_date: null,
        is_recurring: false,
        recurrence_frequency: null,
        location_address: null,
        location_lat: null,
        location_lng: null,
        starting_bid_cents: 10000,
        offer_accepted_cents: null,
        auction_duration_hours: 48,
        auction_ends_at: null,
        bid_count: 0,
        lowest_bid_cents: null,
        market_range: null,
        auction_type: 'sealed',
        snipe_extension_count: 0,
        original_auction_ends_at: null,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        property_id: 'p1',
      },
      {
        id: 'j-done',
        customer_id: 'c1',
        category_id: 'cat-plumb',
        category_name: 'Plumbing',
        category_slug: 'plumbing',
        title: 'Past job',
        description: 'A'.repeat(50),
        status: 'completed',
        schedule_type: 'flexible',
        scheduled_date: null,
        is_recurring: false,
        recurrence_frequency: null,
        location_address: null,
        location_lat: null,
        location_lng: null,
        starting_bid_cents: 8000,
        offer_accepted_cents: 7500,
        auction_duration_hours: 48,
        auction_ends_at: null,
        bid_count: 2,
        lowest_bid_cents: 7500,
        market_range: null,
        auction_type: 'sealed',
        snipe_extension_count: 0,
        original_auction_ends_at: null,
        created_at: '2026-03-01T00:00:00Z',
        updated_at: '2026-03-10T00:00:00Z',
        property_id: 'p1',
      },
    ],
    pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1, hasNext: false },
  } as unknown,
  isLoading: false,
  isError: false,
  isSuccess: true,
  refetch: vi.fn(),
};

const defaultJobs = (jobsState.data as { jobs: unknown[] }).jobs;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/properties/p1',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'p1' }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useProperties', () => ({
  useProperties: () => propertiesState,
  usePreferredProviders: () => preferredState,
  useUpdateProperty: () => ({
    mutateAsync: vi.fn(() => Promise.resolve(property)),
    isPending: false,
  }),
}));

vi.mock('@/components/ui/ImageUpload', () => ({
  ImageUpload: () => createElement('div', { 'data-testid': 'image-upload' }, 'ImageUpload'),
}));

// useCustomerJobs is called twice (unfiltered + filtered). Return same payload;
// filtered query is disabled when no filters active.
vi.mock('@/hooks/useJobs', () => ({
  useCustomerJobs: () => jobsState,
}));

vi.mock('@/components/jobs/JobCard', () => ({
  JobCard: ({ job }: { job: { title: string } }) =>
    createElement('div', { 'data-testid': 'job-card' }, job.title),
}));

const { default: PropertyDetailPage } = await import(
  '@/app/(dashboard)/properties/[id]/page'
);

beforeEach(() => {
  propertiesState.data = [property];
  propertiesState.isLoading = false;
  propertiesState.isError = false;
  preferredState.isError = false;
  preferredState.isLoading = false;
  preferredState.data = {
    preferred_threshold: 3,
    providers: [
      {
        provider_id: 'pr-1',
        display_name: 'Ace Plumbing',
        completed_count: 3,
        last_completed_at: null,
        is_preferred: true,
      },
    ],
  };
  jobsState.isLoading = false;
  jobsState.isError = false;
  jobsState.isSuccess = true;
  jobsState.data = { jobs: defaultJobs };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PropertyDetailPage', () => {
  it('renders property header + preferred provider', () => {
    render(withQueryClient(createElement(PropertyDetailPage)));
    expect(screen.getByRole('heading', { name: 'Lake House' })).toBeDefined();
    expect(screen.getByText('Ace Plumbing')).toBeDefined();
    expect(screen.getByLabelText(/preferred provider/i)).toBeDefined();
  });

  it('splits active vs history jobs', () => {
    render(withQueryClient(createElement(PropertyDetailPage)));
    expect(screen.getByText('Fix pipe')).toBeDefined();
    expect(screen.getByText('Past job')).toBeDefined();
    expect(screen.getByText(/active \(1\)/i)).toBeDefined();
    expect(screen.getByText(/history \(1\)/i)).toBeDefined();
  });

  it('shows history filter controls', () => {
    render(withQueryClient(createElement(PropertyDetailPage)));
    expect(screen.getByLabelText(/filter history by category/i)).toBeDefined();
    expect(screen.getByLabelText(/filter history by date range/i)).toBeDefined();
  });

  it('renders not-found when property missing', () => {
    propertiesState.data = [];
    render(withQueryClient(createElement(PropertyDetailPage)));
    expect(screen.getByText(/property not found/i)).toBeDefined();
  });

  it('shows soft preferred error copy', () => {
    preferredState.isError = true;
    preferredState.data = undefined;
    render(withQueryClient(createElement(PropertyDetailPage)));
    // Property-scoped section still renders the soft error card.
    expect(screen.getByText(/provider summary unavailable/i)).toBeDefined();
  });

  it('sends Post a job to /jobs/new with this property_id', () => {
    jobsState.data = { jobs: [] };
    jobsState.isSuccess = true;
    render(withQueryClient(createElement(PropertyDetailPage)));
    const link = screen.getByRole('link', { name: /post a job/i });
    expect(link.getAttribute('href')).toBe('/jobs/new?property_id=p1');
  });

  it('retries jobs on error', () => {
    jobsState.isError = true;
    jobsState.isSuccess = false;
    jobsState.data = undefined;
    render(withQueryClient(createElement(PropertyDetailPage)));
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(jobsState.refetch).toHaveBeenCalled();
  });
});
