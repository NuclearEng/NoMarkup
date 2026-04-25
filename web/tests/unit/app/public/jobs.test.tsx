// Jobs search index page — covers loading, empty, and success states for the
// search hook. We stub the heavy filter / card components.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

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
  JobSearchFilters: () => createElement('div', { 'data-testid': 'filters' }),
}));

vi.mock('@/components/jobs/SeasonalDemandBanner', () => ({
  SeasonalDemandBanner: () => createElement('div', { 'data-testid': 'seasonal' }),
}));

vi.mock('@/hooks/useJobs', () => ({
  useSearchJobs: vi.fn(),
}));

const { useSearchJobs } = await import('@/hooks/useJobs');
const { default: JobsSearchPage } = await import('@/app/(public)/jobs/page');

describe('(public)/jobs/page', () => {
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

    render(createElement(JobsSearchPage));
    expect(screen.getByRole('heading', { name: /Find/i })).toBeDefined();
    expect(screen.getByTestId('filters')).toBeDefined();
  });

  it('shows the empty state when no jobs are returned', () => {
    vi.mocked(useSearchJobs).mockReturnValue({
      data: { jobs: [], pagination: { totalCount: 0, totalPages: 0, hasNext: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSearchJobs>);

    render(createElement(JobsSearchPage));
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

    render(createElement(JobsSearchPage));
    expect(screen.getByTestId('job-j1')).toBeDefined();
    expect(screen.getByText('Fix sink')).toBeDefined();
    expect(screen.getByText(/1 job/)).toBeDefined();
  });
});
