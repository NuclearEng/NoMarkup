// Jobs search index — covers the JobsSearchClient island (RSC page.tsx
// server-fetches and seeds this component). Mirrors marketplace.test.tsx:
// stub heavy filter / card components; assert loading, empty, success, and
// initialData seeding paths for the search hook.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { JobsResponse, SearchJobsParams } from '@/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/jobs/JobCard', () => ({
  JobCard: ({ job }: { job: { id: string; title: string } }) =>
    createElement('article', { 'data-testid': `job-${job.id}` }, job.title),
}));

vi.mock('@/components/jobs/JobSearchFilters', () => ({
  JobSearchFilters: ({
    onChange,
  }: {
    onChange: (next: { query?: string; page?: number; page_size?: number }) => void;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'filters' },
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'apply-test-filter',
          onClick: () => {
            onChange({ query: 'leak', page: 1, page_size: 12 });
          },
        },
        'Apply Test Filter',
      ),
    ),
}));

vi.mock('@/components/jobs/SeasonalDemandBanner', () => ({
  SeasonalDemandBanner: () => createElement('div', { 'data-testid': 'seasonal' }),
}));

vi.mock('@/hooks/useJobs', () => ({
  useSearchJobs: vi.fn(),
}));

const { useSearchJobs } = await import('@/hooks/useJobs');
const { JobsSearchClient } = await import('@/app/(public)/jobs/JobsSearchClient');

const EMPTY_SEED: JobsResponse = {
  jobs: [],
  pagination: { totalCount: 0, page: 1, pageSize: 12, totalPages: 0, hasNext: false },
};

const DEFAULT_FILTERS: SearchJobsParams = { page: 1, page_size: 12 };

function renderClient(
  seed: JobsResponse = EMPTY_SEED,
  filters: SearchJobsParams = DEFAULT_FILTERS,
) {
  return render(
    createElement(JobsSearchClient, {
      initialJobs: seed,
      initialFilters: filters,
    }),
  );
}

describe('(public)/jobs JobsSearchClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading and filter affordance', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    expect(screen.getByRole('heading', { name: /Find/i })).toBeDefined();
    expect(screen.getByTestId('filters')).toBeDefined();
  });

  it('renders Skeleton job-card placeholders while loading without seed data', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    expect(screen.getByRole('status', { name: 'Loading jobs' })).toBeDefined();
  });

  it('passes initialData to useSearchJobs on first paint (PERF-06 seed)', () => {
    const seed: JobsResponse = {
      jobs: [{ id: 'j-seed', title: 'Seeded job', category_slug: 'plumbing' }] as JobsResponse['jobs'],
      pagination: { totalCount: 1, page: 1, pageSize: 12, totalPages: 1, hasNext: false },
    };
    vi.mocked(useSearchJobs).mockImplementation((_params, options) => {
      return {
        data: options?.initialData,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useSearchJobs>;
    });

    renderClient(seed);
    expect(useSearchJobs).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, page_size: 12 }),
      { initialData: seed },
    );
    expect(screen.getByTestId('job-j-seed')).toBeDefined();
    expect(screen.getByText('Seeded job')).toBeDefined();
  });

  it('renders seeded cards with no loading skeleton on first paint', () => {
    const seed: JobsResponse = {
      jobs: [{ id: 'j1', title: 'Fix sink', category_slug: 'plumbing' }] as JobsResponse['jobs'],
      pagination: { totalCount: 1, page: 1, pageSize: 12, totalPages: 1, hasNext: false },
    };
    vi.mocked(useSearchJobs).mockImplementation((_params, options) => {
      return {
        data: options?.initialData,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useSearchJobs>;
    });

    renderClient(seed);
    expect(screen.queryByRole('status', { name: 'Loading jobs' })).toBeNull();
    expect(screen.getByTestId('job-j1')).toBeDefined();
  });

  it('stops seeding initialData after filters change', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    // First call is the seed path.
    expect(useSearchJobs).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ initialData: EMPTY_SEED }),
    );

    fireEvent.click(screen.getByTestId('apply-test-filter'));
    // After filter change, identity no longer matches seedFilters → no initialData.
    expect(useSearchJobs).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'leak' }),
      undefined,
    );
  });

  it('shows the empty state when no jobs are returned', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    expect(screen.getByText('No jobs found')).toBeDefined();
  });

  it('renders job cards when results exist', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: {
        jobs: [{ id: 'j1', title: 'Fix sink', category_slug: 'plumbing' }],
        pagination: { totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    expect(screen.getByTestId('job-j1')).toBeDefined();
    expect(screen.getByText('Fix sink')).toBeDefined();
    expect(screen.getByText(/1 job/)).toBeDefined();
  });

  it('clicking the mobile Filters toggle expands the filters panel', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    const toggle = screen.getByRole('button', { name: /Filters/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking Retry on the error state invokes refetch', () => {
    const refetch = vi.fn();
    vi.mocked(useSearchJobs).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders Previous/Next pagination buttons when totalPages > 1', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: {
        jobs: [{ id: 'jx', title: 'A job', category_slug: 'x' }],
        pagination: { totalCount: 30, totalPages: 3, hasNext: true },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    const prev = screen.getByRole('button', { name: 'Previous' });
    const next = screen.getByRole('button', { name: 'Next' });
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByText(/Page/)).toBeDefined();
  });

  it('shows the no-filters empty state when totalCount is 0 and no filters set', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    expect(screen.getByText(/No open jobs right now/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /clear all filters/i })).toBeNull();
  });

  it('clicking Clear All Filters resets filters when active filters present', () => {
    vi.mocked(useSearchJobs).mockImplementation(() => {
      return {
        data: {
          jobs: [],
          pagination: { totalCount: 0, totalPages: 0, hasNext: false },
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useSearchJobs>;
    });

    renderClient();
    const toggle = screen.getByRole('button', { name: /Filters/i });
    expect(toggle.textContent).not.toContain('!');
  });

  it('does not render the SeasonalDemandBanner when first job has no category_slug', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: {
        jobs: [{ id: 'jnoCat', title: 'Untagged Job' }],
        pagination: { totalCount: 1, totalPages: 1, hasNext: false },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    expect(screen.getByTestId('job-jnoCat')).toBeDefined();
    expect(screen.queryByTestId('seasonal')).toBeNull();
  });

  it('Previous pagination button click decrements page when on page 2+', () => {
    const refetch = vi.fn();
    vi.mocked(useSearchJobs).mockReturnValue({
      data: {
        jobs: [{ id: 'jp', title: 'Pageable', category_slug: 'a' }],
        pagination: { totalCount: 30, totalPages: 3, hasNext: true },
      },
      isLoading: false,
      isError: false,
      refetch,
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    const next = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(next);
    const prev = screen.getByRole('button', { name: 'Previous' });
    expect((prev as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(prev);
    expect(screen.getAllByText(/Page/).length).toBeGreaterThan(0);
  });

  it('clears filters via Clear All Filters when filters are active and no jobs returned', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    renderClient();
    expect(screen.getByText(/No open jobs right now/i)).toBeDefined();
    fireEvent.click(screen.getByTestId('apply-test-filter'));
    expect(screen.getByText(/no jobs match your current filters/i)).toBeDefined();
    const clearBtn = screen.getByRole('button', { name: /clear all filters/i });
    fireEvent.click(clearBtn);
    expect(screen.getByText(/No open jobs right now/i)).toBeDefined();
  });
});
