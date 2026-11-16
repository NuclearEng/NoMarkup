// LegalLandingClient — the `/legal` client island. Asserts the exact params
// and initialData handed to useSearchJobs for the root view vs. a narrowed
// practice area, where the practice-area options come from, and the
// loading / error (+ retry) / empty / populated states of the case list.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job, JobsResponse, SearchJobsParams, ServiceCategory } from '@/types';

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/jobs/JobCard', () => ({
  JobCard: ({ job }: { job: Job }) => createElement('article', { 'data-testid': 'job-card' }, job.title),
}));

// Radix Select does not open in jsdom; stand in a native <select> that keeps
// the same value / onValueChange contract.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      'select',
      {
        'data-testid': 'practice-area-select',
        value,
        onChange: (event: { target: { value: string } }) => {
          onValueChange(event.target.value);
        },
      },
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement('option', { value }, children),
}));

const categoryTree: { data: ServiceCategory[] | undefined } = { data: undefined };
vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: () => ({ data: categoryTree.data }),
}));

interface SearchState {
  data: JobsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}

type SearchCall = [SearchJobsParams, { initialData?: JobsResponse } | undefined];

const refetch = vi.fn<() => Promise<void>>();
const searchCalls: SearchCall[] = [];
/** Per-category overrides keyed by category_id ('' = no category filter). */
const searchStates = new Map<string, SearchState>();

vi.mock('@/hooks/useJobs', () => ({
  useSearchJobs: (params: SearchJobsParams, options?: { initialData?: JobsResponse }) => {
    searchCalls.push([params, options]);
    const state = searchStates.get(params.category_id ?? '');
    return {
      // Mirrors react-query: with initialData and no fetch result, data IS the seed.
      data: state ? state.data : options?.initialData,
      isLoading: state?.isLoading ?? false,
      isError: state?.isError ?? false,
      refetch,
    };
  },
}));

import { LegalLandingClient } from '@/app/(public)/legal/LegalLandingClient';

const PAGINATION: JobsResponse['pagination'] = {
  totalCount: 2,
  page: 1,
  pageSize: 12,
  totalPages: 1,
  hasNext: false,
};

function makeJob(id: string, title: string): Job {
  return { id, title } as Job;
}

const SEEDED: JobsResponse = {
  jobs: [makeJob('job-1', 'Draft an LLC operating agreement'), makeJob('job-2', 'Review a lease')],
  pagination: PAGINATION,
};

const EMPTY: JobsResponse = { jobs: [], pagination: { ...PAGINATION, totalCount: 0, totalPages: 0 } };

function makeCategory(id: string, slug: string, name: string, children?: ServiceCategory[]): ServiceCategory {
  return {
    id,
    parentId: null,
    name,
    slug,
    level: 1,
    description: null,
    icon: null,
    sortOrder: 0,
    ...(children ? { children } : {}),
  };
}

const TREE: ServiceCategory[] = [
  makeCategory('cat-home', 'home-services', 'Home Services', [
    makeCategory('cat-plumb', 'plumbing', 'Plumbing'),
  ]),
  makeCategory('cat-legal', 'legal', 'Legal', [
    makeCategory('cat-wills', 'wills', 'Wills & Estates'),
    makeCategory('cat-biz', 'business-formation', 'Business Formation'),
  ]),
];

function lastSearchCall(): SearchCall {
  const call = searchCalls.at(-1);
  if (!call) throw new Error('useSearchJobs was not called');
  return call;
}

function selectPracticeArea(value: string): void {
  fireEvent.change(screen.getByTestId('practice-area-select'), { target: { value } });
}

beforeEach(() => {
  categoryTree.data = TREE;
  searchCalls.length = 0;
  searchStates.clear();
  refetch.mockReset();
  refetch.mockResolvedValue(undefined);
});

describe('LegalLandingClient — browse query', () => {
  it('queries the legal subtree root and seeds it with the server page', () => {
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    expect(lastSearchCall()).toEqual([
      { page: 1, page_size: 12, category_id: 'cat-legal' },
      { initialData: SEEDED },
    ]);
  });

  it('sends no category filter when the legal category could not be resolved', () => {
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId={null} />);
    const [params, options] = lastSearchCall();
    expect(params).toEqual({ page: 1, page_size: 12 });
    expect(params).not.toHaveProperty('category_id');
    expect(options).toEqual({ initialData: SEEDED });
  });

  it('narrows to the chosen practice area without seeding it from the root page', () => {
    searchStates.set('cat-wills', {
      data: { jobs: [makeJob('job-9', 'Update a will')], pagination: PAGINATION },
      isLoading: false,
      isError: false,
    });
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    selectPracticeArea('cat-wills');

    expect(lastSearchCall()).toEqual([{ page: 1, page_size: 12, category_id: 'cat-wills' }, undefined]);
    expect(screen.getAllByTestId('job-card').map((c) => c.textContent)).toEqual(['Update a will']);
  });

  it('returns to the seeded root view when "All practice areas" is re-selected', () => {
    searchStates.set('cat-wills', { data: EMPTY, isLoading: false, isError: false });
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    selectPracticeArea('cat-wills');
    expect(screen.queryAllByTestId('job-card')).toHaveLength(0);

    selectPracticeArea('all');
    expect(lastSearchCall()).toEqual([
      { page: 1, page_size: 12, category_id: 'cat-legal' },
      { initialData: SEEDED },
    ]);
    expect(screen.getAllByTestId('job-card')).toHaveLength(2);
  });
});

describe('LegalLandingClient — practice-area filter', () => {
  it('lists only the children of the legal root, after the "all" option', () => {
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    expect(screen.getByText('Practice area')).toBeInTheDocument();
    const options = within(screen.getByTestId('practice-area-select')).getAllByRole('option');
    expect(options.map((o) => [o.getAttribute('value'), o.textContent])).toEqual([
      ['all', 'All practice areas'],
      ['cat-wills', 'Wills & Estates'],
      ['cat-biz', 'Business Formation'],
    ]);
  });

  it.each<[string, ServiceCategory[] | undefined]>([
    ['the category tree has not loaded', undefined],
    ['the tree has no legal root', [makeCategory('cat-home', 'home-services', 'Home Services')]],
    ['the legal root has no children', [makeCategory('cat-legal', 'legal', 'Legal')]],
    ['the legal root has an empty children list', [makeCategory('cat-legal', 'legal', 'Legal', [])]],
  ])('hides the filter when %s', (_label, tree) => {
    categoryTree.data = tree;
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    expect(screen.queryByText('Practice area')).toBeNull();
    expect(screen.queryByTestId('practice-area-select')).toBeNull();
    // The list and the escape hatch to all jobs are unaffected.
    expect(screen.getAllByTestId('job-card')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'See all jobs' })).toHaveAttribute('href', '/jobs');
  });
});

describe('LegalLandingClient — case list states', () => {
  it('renders one card per seeded job on first paint, with no loading or empty state', () => {
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    expect(screen.getAllByTestId('job-card').map((c) => c.textContent)).toEqual([
      'Draft an LLC operating agreement',
      'Review a lease',
    ]);
    expect(screen.queryByRole('status', { name: 'Loading legal cases' })).toBeNull();
    expect(screen.queryByText('No open legal cases right now')).toBeNull();
  });

  it('falls back to the seeded jobs in the root view when the query has no data', () => {
    searchStates.set('cat-legal', { data: undefined, isLoading: true, isError: true });
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    // Seeded jobs win over both the skeleton and the error state.
    expect(screen.getAllByTestId('job-card')).toHaveLength(2);
    expect(screen.queryByRole('status', { name: 'Loading legal cases' })).toBeNull();
    expect(screen.queryByText("Couldn't load legal cases")).toBeNull();
  });

  it('shows skeletons while a narrowed practice area is loading, not the root jobs', () => {
    searchStates.set('cat-biz', { data: undefined, isLoading: true, isError: false });
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    selectPracticeArea('cat-biz');
    expect(screen.getByRole('status', { name: 'Loading legal cases' })).toBeInTheDocument();
    expect(screen.queryAllByTestId('job-card')).toHaveLength(0);
  });

  it('shows the error state with a Retry that refetches', () => {
    searchStates.set('cat-biz', { data: undefined, isLoading: false, isError: true });
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    selectPracticeArea('cat-biz');

    expect(screen.getByText("Couldn't load legal cases")).toBeInTheDocument();
    expect(
      screen.getByText('Something went wrong fetching open legal jobs. Try again.'),
    ).toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with a post-a-legal-job CTA when there are no cases', () => {
    render(<LegalLandingClient initialJobs={EMPTY} legalCategoryId="cat-legal" />);
    expect(screen.getByText('No open legal cases right now')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    const postLinks = screen.getAllByRole('link', { name: /Post a legal job/ });
    // Hero CTA + empty-state CTA, both to the legal intake form.
    expect(postLinks.map((l) => l.getAttribute('href'))).toEqual(['/jobs/new/legal', '/jobs/new/legal']);
  });

  it('shows the empty state for a narrowed area that returned an empty page', () => {
    searchStates.set('cat-wills', { data: EMPTY, isLoading: false, isError: false });
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    selectPracticeArea('cat-wills');
    expect(screen.getByText('No open legal cases right now')).toBeInTheDocument();
  });
});

describe('LegalLandingClient — static content', () => {
  it('links the hero CTAs to the legal intake form and the open-cases anchor', () => {
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    expect(screen.getByRole('link', { name: /Post a legal job/ })).toHaveAttribute(
      'href',
      '/jobs/new/legal',
    );
    expect(screen.getByRole('link', { name: 'Browse open cases' })).toHaveAttribute(
      'href',
      '#open-cases',
    );
    expect(screen.getByRole('region', { name: 'Open legal cases' })).toHaveAttribute(
      'id',
      'open-cases',
    );
  });

  it('numbers the three how-it-works steps in order', () => {
    render(<LegalLandingClient initialJobs={SEEDED} legalCategoryId="cat-legal" />);
    const section = screen.getByRole('region', { name: 'How it works' });
    const steps = within(section).getAllByRole('listitem');
    expect(steps.map((s) => within(s).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Describe your case',
      'Lawyers compete',
      'Pick your lawyer',
    ]);
    expect(steps.map((s) => s.querySelector('span')?.textContent)).toEqual(['1', '2', '3']);
  });
});
