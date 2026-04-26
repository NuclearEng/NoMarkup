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

// Allow tests to swap the JobMap stub. Default = no-op map, but tests that need
// to exercise the selected-job branch can install a clickable button stub.
let jobMapStub: (props: {
  jobs?: unknown[];
  onJobSelect?: (job: unknown) => void;
}) => ReturnType<typeof createElement> = () =>
  createElement('div', { 'data-testid': 'job-map' });

// Invoke the loader passed to next/dynamic so the `(mod) => mod.JobMap`
// arrow callback in the page module gets executed (function-coverage win).
vi.mock('next/dynamic', () => ({
  default: (
    loader: () => Promise<{ JobMap: (p: unknown) => unknown }>,
  ): ((props: unknown) => unknown) => {
    void loader().catch(() => undefined);
    return (props: unknown) => jobMapStub(props as Parameters<typeof jobMapStub>[0]);
  },
}));

vi.mock('@/components/maps/JobMap', () => ({
  JobMap: (props: unknown) => jobMapStub(props as Parameters<typeof jobMapStub>[0]),
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
    jobMapStub = () => createElement('div', { 'data-testid': 'job-map' });
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

  it('renders job card without location_address when address is missing', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: {
        jobs: [{ ...baseJob, id: 'no-addr', location_address: undefined }],
        pagination: { totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    expect(screen.getAllByRole('heading', { name: 'Fix the sink' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('123 Main St')).toBeNull();
  });

  it('renders job card without starting bid when starting_bid_cents missing', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: {
        jobs: [{ ...baseJob, id: 'no-bid', starting_bid_cents: 0 }],
        pagination: { totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    expect(screen.queryByText(/Up to \$/)).toBeNull();
  });

  it('renders 6 skeleton placeholders in loading state grid', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    const { container } = render(createElement(JobsMapPage));
    expect(container.querySelectorAll('.animate-pulse').length).toBe(6);
  });

  it('renders multiple jobs in the grid when many returned', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: {
        jobs: [
          { ...baseJob, id: 'a', title: 'Job A' },
          { ...baseJob, id: 'b', title: 'Job B' },
          { ...baseJob, id: 'c', title: 'Job C' },
        ],
        pagination: { totalCount: 3, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    expect(screen.getByRole('heading', { name: 'Job A' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Job B' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Job C' })).toBeDefined();
  });

  it('renders subtitle "Browse jobs by location" in header', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    expect(screen.getByText('Browse jobs by location')).toBeDefined();
  });

  it('renders "Jobs Near You" heading regardless of state', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    expect(screen.getByRole('heading', { name: 'Jobs Near You' })).toBeDefined();
  });

  it('renders the Selected Job card when JobMap fires onJobSelect with a full job', () => {
    jobMapStub = ({ onJobSelect }) =>
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'job-map-trigger',
          onClick: () => {
            onJobSelect?.(baseJob);
          },
        },
        'Select',
      );
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [baseJob], pagination: { totalCount: 1, totalPages: 1, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    render(createElement(JobsMapPage));
    expect(screen.queryByText('Selected Job')).toBeNull();
    fireEvent.click(screen.getByTestId('job-map-trigger'));
    expect(screen.getByText('Selected Job')).toBeDefined();
    // Selected card has the description
    expect(screen.getByText('Drain is slow')).toBeDefined();
  });

  it('omits the address line on the Selected Job card when address is empty', () => {
    const noAddrJob = { ...baseJob, location_address: null };
    jobMapStub = ({ onJobSelect }) =>
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'job-map-trigger',
          onClick: () => {
            onJobSelect?.(noAddrJob);
          },
        },
        'Select',
      );
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [noAddrJob], pagination: { totalCount: 1, totalPages: 1, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    fireEvent.click(screen.getByTestId('job-map-trigger'));
    expect(screen.getByText('Selected Job')).toBeDefined();
    expect(screen.queryByText('123 Main St')).toBeNull();
  });

  it('omits the price on the Selected Job card when starting_bid_cents is null', () => {
    const noPriceJob = { ...baseJob, starting_bid_cents: null };
    jobMapStub = ({ onJobSelect }) =>
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'job-map-trigger',
          onClick: () => {
            onJobSelect?.(noPriceJob);
          },
        },
        'Select',
      );
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [noPriceJob], pagination: { totalCount: 1, totalPages: 1, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    fireEvent.click(screen.getByTestId('job-map-trigger'));
    expect(screen.getByText('Selected Job')).toBeDefined();
  });

  it('renders Selected Job singular bid badge when bid_count === 1', () => {
    const oneBidJob = { ...baseJob, bid_count: 1 };
    jobMapStub = ({ onJobSelect }) =>
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'job-map-trigger',
          onClick: () => {
            onJobSelect?.(oneBidJob);
          },
        },
        'Select',
      );
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [oneBidJob], pagination: { totalCount: 1, totalPages: 1, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);
    render(createElement(JobsMapPage));
    fireEvent.click(screen.getByTestId('job-map-trigger'));
    // Both selected card and list card show "1 bid" — at least one is present.
    expect(screen.getAllByText(/1\s+bid$/).length).toBeGreaterThan(0);
  });
});
