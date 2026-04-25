// Jobs map page — Mapbox is dynamically imported with ssr:false; we stub it
// and assert the page heading + list-view link render.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs/map',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('next/dynamic', () => ({
  default: () => () => createElement('div', { 'data-testid': 'job-map' }, 'Map Stub'),
}));

vi.mock('@/components/maps/JobMap', () => ({
  JobMap: () => createElement('div', { 'data-testid': 'job-map' }),
}));

vi.mock('@/hooks/useJobs', () => ({
  useSearchJobs: vi.fn(),
}));

const { useSearchJobs } = await import('@/hooks/useJobs');
const { default: JobsMapPage } = await import('@/app/(public)/jobs/map/page');

const baseJob = {
  id: 'job-1',
  title: 'Fix the sink',
  description: 'Drain is slow',
  category_name: 'Plumbing',
  category_slug: 'plumbing',
  bid_count: 2,
  starting_bid_cents: 15000,
  location_address: '123 Main St',
  location_lat: 37.7749,
  location_lng: -122.4194,
};

describe('(public)/jobs/map/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading and a link back to list view', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    render(createElement(JobsMapPage));
    expect(screen.getByRole('heading', { name: 'Job Map' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'List View' })).toBeDefined();
  });

  it('renders the loading state when jobs are still loading', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    render(createElement(JobsMapPage));
    expect(screen.getByText(/Loading jobs/)).toBeDefined();
  });

  it('renders the error fallback for the map and calls refetch on Retry', () => {
    const refetch = vi.fn();
    vi.mocked(useSearchJobs).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useSearchJobs>);

    render(createElement(JobsMapPage));
    expect(screen.getByText('Failed to load job data for the map.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty job list when there are no jobs', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    expect(screen.getByText('No active jobs found.')).toBeDefined();
  });

  it('renders the failed-to-load list state when jobs error after the map area renders', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    expect(screen.getByText('Failed to load jobs.')).toBeDefined();
  });

  it('renders job cards with title, category, and bid count plural', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: {
        jobs: [baseJob],
        pagination: { totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    expect(screen.getByRole('heading', { name: 'Fix the sink' })).toBeDefined();
    // Plural "bids" because count is 2
    expect(screen.getAllByText(/2\s+bids/).length).toBeGreaterThan(0);
    // Address shows on the job card
    expect(screen.getAllByText('123 Main St').length).toBeGreaterThan(0);
  });

  it('renders a single bid in singular form when count === 1', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: {
        jobs: [{ ...baseJob, id: 'job-2', bid_count: 1 }],
        pagination: { totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    expect(screen.getAllByText(/1\s+bid$/).length).toBeGreaterThan(0);
  });

  it('renders the loading skeleton grid for the job list while loading', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    const { container } = render(createElement(JobsMapPage));
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});
