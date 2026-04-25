// Jobs map page — Mapbox is dynamically imported with ssr:false; we stub it
// and assert the page heading + list-view link render.
import { render, screen } from '@testing-library/react';
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
});
