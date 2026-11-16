// Branch tests for the property detail page beyond properties-id.test.tsx:
// route-param guards, loading/error states, the photo editor (append / cap /
// remove / save / cancel), job bucketing, and the history filters — including
// the exact queries they issue and the client-side re-filter used when the
// server-filtered query soft-fails.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerJobsParams } from '@/hooks/useJobs';
import type { Property } from '@/hooks/useProperties';
import type { Job } from '@/types';

interface QueryState {
  data: { jobs: Job[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface UploadProps {
  existingImages: string[];
  maxFiles: number;
  onUploadComplete: (result: { objectKey: string; confirmedUrl: string }) => void;
  onRemove: (url: string) => void;
}

interface PreferredProps {
  providers: unknown;
  isLoading: boolean;
  isError: boolean;
  preferredThreshold: number | undefined;
  scope: string;
}

const h = vi.hoisted(() => ({
  params: { id: 'p1' } as Record<string, string | string[] | undefined>,
  properties: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  preferred: { data: undefined as unknown, isLoading: false, isError: false },
  preferredArgs: [] as unknown[],
  update: { mutateAsync: vi.fn(), isPending: false },
  jobsCalls: [] as unknown[],
  mainJobs: undefined as unknown,
  filteredJobs: undefined as unknown,
  upload: [] as unknown[],
  preferredProps: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useParams: () => h.params,
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useProperties', () => ({
  useProperties: () => h.properties,
  usePreferredProviders: (args: unknown) => {
    h.preferredArgs.push(args);
    return h.preferred;
  },
  useUpdateProperty: () => h.update,
}));

vi.mock('@/hooks/useJobs', () => ({
  useCustomerJobs: (params: CustomerJobsParams) => {
    h.jobsCalls.push(params);
    const isFilteredQuery = 'category_id' in params;
    return isFilteredQuery ? h.filteredJobs : h.mainJobs;
  },
}));

vi.mock('@/components/ui/ImageUpload', () => ({
  ImageUpload: (props: unknown) => {
    h.upload.push(props);
    return createElement('div', { 'data-testid': 'image-upload' });
  },
}));

vi.mock('@/components/properties/PreferredProvidersSection', () => ({
  PreferredProvidersSection: (props: unknown) => {
    h.preferredProps.push(props);
    return createElement('div', { 'data-testid': 'preferred' });
  },
}));

vi.mock('@/components/properties/PropertySpendLabel', () => ({
  PropertySpendLabel: ({ propertyId, detailed }: { propertyId: string; detailed?: boolean }) =>
    createElement('span', {
      'data-testid': detailed ? 'spend-detailed' : 'spend-label',
      'data-property': propertyId,
    }),
}));

vi.mock('@/components/ui/content-loader', () => ({
  ContentLoader: ({ preset }: { preset: string }) =>
    createElement('div', { 'data-testid': `loader-${preset}` }),
}));

vi.mock('@/components/jobs/JobCard', () => ({
  JobCard: ({ job }: { job: Job }) => createElement('div', { 'data-testid': 'job-card' }, job.title),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (val: string) => void;
    children: React.ReactNode;
  }) =>
    createElement(
      'select',
      {
        value,
        'data-testid': 'select',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          onValueChange(e.target.value);
        },
      },
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) =>
    createElement('option', { value }, children),
}));

const { default: PropertyDetailPage } = await import('@/app/(dashboard)/properties/[id]/page');

const DAY_MS = 86_400_000;
const NOW = new Date('2026-06-15T12:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: 'p1',
    nickname: 'Lake House',
    address: { street: '123 Lakefront Rd', city: 'Bellevue', state: 'WA', zip_code: '98004' },
    notes: 'Gate code 1234',
    active_jobs: 2,
    ...overrides,
  } as Property;
}

function job(overrides: Partial<Job>): Job {
  return {
    id: 'job',
    title: 'Job',
    status: 'completed',
    category_id: 'cat-plumb',
    category_name: 'Plumbing',
    created_at: daysAgo(10),
    ...overrides,
  } as Job;
}

function query(jobs: Job[] | undefined, overrides: Partial<QueryState> = {}): QueryState {
  return {
    data: jobs ? { jobs } : undefined,
    isLoading: false,
    isError: false,
    isSuccess: jobs !== undefined,
    refetch: vi.fn(),
    ...overrides,
  };
}

function lastUploadProps(): UploadProps {
  const props = h.upload.at(-1);
  if (!props) throw new Error('ImageUpload was not rendered');
  return props as UploadProps;
}

function lastPreferredProps(): PreferredProps {
  const props = h.preferredProps.at(-1);
  if (!props) throw new Error('PreferredProvidersSection was not rendered');
  return props as PreferredProps;
}

/** The most recent [unfiltered, filtered] useCustomerJobs argument pair. */
function lastJobQueries(): [CustomerJobsParams, CustomerJobsParams] {
  const [main, filtered] = h.jobsCalls.slice(-2);
  if (!main || !filtered) throw new Error('useCustomerJobs was not called twice');
  return [main as CustomerJobsParams, filtered as CustomerJobsParams];
}

function selects(): { category: HTMLElement; dateRange: HTMLElement } {
  const [category, dateRange] = screen.getAllByTestId('select');
  if (!category || !dateRange) throw new Error('history filters not rendered');
  return { category, dateRange };
}

function cardTitles(): string[] {
  const history = screen.getByRole('region', { name: /^History/ });
  return within(history)
    .getAllByTestId('job-card')
    .map((card) => card.textContent);
}

function renderPage() {
  return render(createElement(PropertyDetailPage));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  h.params = { id: 'p1' };
  h.properties.data = [property()];
  h.properties.isLoading = false;
  h.properties.isError = false;
  h.properties.refetch = vi.fn();
  h.preferred.data = { providers: [], preferred_threshold: 4 };
  h.preferred.isLoading = false;
  h.preferred.isError = false;
  h.update.mutateAsync = vi.fn(() => Promise.resolve(property()));
  h.update.isPending = false;
  h.mainJobs = query([]);
  h.filteredJobs = query(undefined);
  h.jobsCalls.length = 0;
  h.upload.length = 0;
  h.preferredProps.length = 0;
  h.preferredArgs.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PropertyDetailPage — route param and top-level states', () => {
  it('disables every property-scoped query when the id param is not a single string', () => {
    h.params = { id: ['p1', 'p2'] };
    renderPage();

    expect(screen.getByText('Property not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to properties' })).toHaveAttribute(
      'href',
      '/properties',
    );
    expect(h.preferredArgs.at(-1)).toEqual({ propertyId: '', usePropertyPath: true, enabled: false });
    const [main, filtered] = lastJobQueries();
    expect(main).toEqual({ property_id: undefined, page_size: 100, enabled: false });
    expect(filtered).toEqual({
      property_id: undefined,
      category_id: undefined,
      date_from: undefined,
      page_size: 100,
      enabled: false,
    });
  });

  it('scopes the queries to the route property and keeps the filtered query off by default', () => {
    renderPage();
    expect(h.preferredArgs.at(-1)).toEqual({ propertyId: 'p1', usePropertyPath: true, enabled: true });
    const [main, filtered] = lastJobQueries();
    expect(main).toEqual({ property_id: 'p1', page_size: 100, enabled: true });
    expect(filtered.enabled).toBe(false);
  });

  it('shows the loader instead of content while properties load', () => {
    h.properties.isLoading = true;
    h.properties.data = undefined;
    renderPage();
    expect(screen.getByTestId('loader-contract-card')).toBeInTheDocument();
    expect(screen.queryByText('Property not found')).not.toBeInTheDocument();
  });

  it('offers a retry that refetches properties when the list fails', () => {
    h.properties.isError = true;
    h.properties.data = undefined;
    renderPage();
    expect(screen.getByText('Failed to load property')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.properties.refetch).toHaveBeenCalledTimes(1);
  });

  it('treats a property id that is not in the list as not found', () => {
    h.params = { id: 'someone-elses' };
    renderPage();
    expect(screen.getByText('Property not found')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lake House' })).not.toBeInTheDocument();
  });
});

describe('PropertyDetailPage — header', () => {
  it('renders address, notes, plural job count and both spend labels for this property', () => {
    renderPage();
    expect(screen.getByText('123 Lakefront Rd, Bellevue, WA 98004')).toBeInTheDocument();
    expect(screen.getByText('Gate code 1234')).toBeInTheDocument();
    expect(screen.getByText('2 active jobs')).toBeInTheDocument();
    expect(screen.getByTestId('spend-label')).toHaveAttribute('data-property', 'p1');
    expect(screen.getByTestId('spend-detailed')).toHaveAttribute('data-property', 'p1');
  });

  it('uses the singular for exactly one active job and omits empty notes', () => {
    h.properties.data = [property({ active_jobs: 1, notes: '' })];
    renderPage();
    expect(screen.getByText('1 active job')).toBeInTheDocument();
    expect(screen.queryByText('Gate code 1234')).not.toBeInTheDocument();
  });

  it('counts a missing active_jobs as zero', () => {
    h.properties.data = [property({ active_jobs: undefined })];
    renderPage();
    expect(screen.getByText('0 active jobs')).toBeInTheDocument();
  });

  it('passes the server preferred threshold through, or undefined when it is null/absent', () => {
    const view = renderPage();
    expect(lastPreferredProps()).toMatchObject({
      providers: [],
      preferredThreshold: 4,
      scope: 'property',
      isLoading: false,
      isError: false,
    });

    h.preferred.data = { providers: [], preferred_threshold: null };
    view.rerender(createElement(PropertyDetailPage));
    expect(lastPreferredProps().preferredThreshold).toBeUndefined();

    h.preferred.data = undefined;
    h.preferred.isLoading = true;
    view.rerender(createElement(PropertyDetailPage));
    expect(lastPreferredProps()).toMatchObject({
      providers: undefined,
      preferredThreshold: undefined,
      isLoading: true,
    });
  });
});

describe('PropertyDetailPage — photo editor', () => {
  function upload(url: string) {
    act(() => {
      lastUploadProps().onUploadComplete({ objectKey: `key-${url}`, confirmedUrl: url });
    });
  }

  it('starts from the saved photos with no save bar', () => {
    h.properties.data = [property({ photo_urls: ['a.jpg', 'b.jpg'] })];
    renderPage();
    expect(lastUploadProps().existingImages).toEqual(['a.jpg', 'b.jpg']);
    expect(lastUploadProps().maxFiles).toBe(5);
    expect(screen.getByText('2/5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save photos' })).not.toBeInTheDocument();
  });

  it('treats a property without photo_urls as an empty gallery', () => {
    renderPage();
    expect(lastUploadProps().existingImages).toEqual([]);
    expect(screen.getByText('0/5')).toBeInTheDocument();
    upload('first.jpg');
    expect(lastUploadProps().existingImages).toEqual(['first.jpg']);
    act(() => {
      lastUploadProps().onRemove('first.jpg');
    });
    expect(lastUploadProps().existingImages).toEqual([]);
    // An emptied gallery is still an unsaved edit.
    expect(screen.getByRole('button', { name: 'Save photos' })).toBeInTheDocument();
  });

  it('appends uploads, saves the edited list for this property, then clears the edit', async () => {
    h.properties.data = [property({ photo_urls: ['a.jpg'] })];
    renderPage();
    upload('b.jpg');
    upload('c.jpg');
    expect(screen.getByText('3/5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save photos' }));
    expect(h.update.mutateAsync).toHaveBeenCalledWith({
      id: 'p1',
      input: { photo_urls: ['a.jpg', 'b.jpg', 'c.jpg'] },
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save photos' })).not.toBeInTheDocument();
    });
    // Back to the server copy once the edit buffer is dropped.
    expect(lastUploadProps().existingImages).toEqual(['a.jpg']);
  });

  it('ignores uploads past the five-photo cap', () => {
    h.properties.data = [property({ photo_urls: ['1.jpg', '2.jpg', '3.jpg', '4.jpg'] })];
    renderPage();
    upload('5.jpg');
    upload('6.jpg');
    expect(lastUploadProps().existingImages).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg']);
    expect(screen.getByText('5/5')).toBeInTheDocument();
  });

  it('does not open an edit when a full saved gallery receives another upload result', () => {
    h.properties.data = [property({ photo_urls: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'] })];
    renderPage();
    upload('6.jpg');
    expect(lastUploadProps().existingImages).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg']);
  });

  it('removes a saved photo and discards the edit on Cancel', () => {
    h.properties.data = [property({ photo_urls: ['a.jpg', 'b.jpg'] })];
    renderPage();
    act(() => {
      lastUploadProps().onRemove('a.jpg');
    });
    expect(lastUploadProps().existingImages).toEqual(['b.jpg']);
    expect(screen.getByText('1/5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(lastUploadProps().existingImages).toEqual(['a.jpg', 'b.jpg']);
    expect(h.update.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('disables the save button and relabels it while the update is pending', () => {
    h.update.isPending = true;
    renderPage();
    upload('new.jpg');
    const saving = screen.getByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
  });
});

describe('PropertyDetailPage — jobs', () => {
  it('shows the job-card loader while jobs load', () => {
    h.mainJobs = query(undefined, { isLoading: true });
    renderPage();
    expect(screen.getByTestId('loader-job-card')).toBeInTheDocument();
    expect(screen.queryByText('No jobs yet')).not.toBeInTheDocument();
  });

  it('retries the jobs query from its error state', () => {
    const state = query(undefined, { isError: true });
    h.mainJobs = state;
    renderPage();
    expect(screen.getByText('Failed to load jobs')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it('buckets jobs into active, upcoming and history by status', () => {
    h.mainJobs = query([
      job({ id: '1', title: 'Open auction', status: 'active' }),
      job({ id: '2', title: 'Crew on site', status: 'in_progress' }),
      job({ id: '3', title: 'Awarded roof', status: 'awarded' }),
      job({ id: '4', title: 'Awaiting signature', status: 'contract_pending' }),
      job({ id: '5', title: 'Old fence', status: 'completed' }),
      job({ id: '6', title: 'Scrapped idea', status: 'cancelled' }),
    ]);
    renderPage();

    const active = screen.getByRole('region', { name: 'Active (2)' });
    expect(within(active).getAllByTestId('job-card').map((c) => c.textContent)).toEqual([
      'Open auction',
      'Crew on site',
    ]);
    const upcoming = screen.getByRole('region', { name: 'Upcoming (2)' });
    expect(within(upcoming).getAllByTestId('job-card').map((c) => c.textContent)).toEqual([
      'Awarded roof',
      'Awaiting signature',
    ]);
    expect(screen.getByRole('heading', { name: 'History (2)' })).toBeInTheDocument();
    expect(cardTitles()).toEqual(['Old fence', 'Scrapped idea']);
  });

  it('omits the active, upcoming and history sections that have no jobs', () => {
    h.mainJobs = query([job({ id: '3', title: 'Awarded roof', status: 'awarded' })]);
    renderPage();
    expect(screen.getByRole('region', { name: 'Upcoming (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Active/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^History/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Filter history')).not.toBeInTheDocument();
  });
});

describe('PropertyDetailPage — history filters', () => {
  const history = [
    job({ id: 'h1', title: 'Recent plumbing', category_id: 'cat-plumb', category_name: 'Plumbing', created_at: daysAgo(10) }),
    job({ id: 'h2', title: 'Spring roofing', category_id: 'cat-roof', category_name: 'Roofing', created_at: daysAgo(60) }),
    job({ id: 'h3', title: 'Winter plumbing', category_id: 'cat-plumb', category_name: 'Plumbing', created_at: daysAgo(200) }),
    job({ id: 'h4', title: 'Ancient electrical', category_id: 'cat-elec', category_name: '  ', created_at: daysAgo(500) }),
    job({ id: 'h5', title: 'Uncategorised', category_id: '   ', category_name: 'Ghost', created_at: daysAgo(5) }),
  ];

  beforeEach(() => {
    h.mainJobs = query(history);
  });

  it('builds de-duplicated, name-sorted category options, skipping blank ids', () => {
    renderPage();
    const options = within(selects().category)
      .getAllByRole('option')
      .map((o) => [o.getAttribute('value'), o.textContent]);
    expect(options).toEqual([
      ['all', 'All categories'],
      // A blank name falls back to the id; "Ghost" (blank id) is dropped.
      ['cat-elec', 'cat-elec'],
      ['cat-plumb', 'Plumbing'],
      ['cat-roof', 'Roofing'],
    ]);
  });

  it('issues a server-filtered query for the chosen category and renders its history rows', () => {
    h.filteredJobs = query([
      job({ id: 'h1', title: 'Recent plumbing (server)', category_id: 'cat-plumb' }),
      // The server result is still restricted to history statuses…
      job({ id: 'x1', title: 'Live plumbing auction', category_id: 'cat-plumb', status: 'active' }),
      // …and re-checked against the selected category.
      job({ id: 'x2', title: 'Stray roofing', category_id: 'cat-roof' }),
    ]);
    renderPage();
    fireEvent.change(selects().category, { target: { value: 'cat-plumb' } });

    const [main, filtered] = lastJobQueries();
    expect(main).toEqual({ property_id: 'p1', page_size: 100, enabled: true });
    expect(filtered).toEqual({
      property_id: 'p1',
      category_id: 'cat-plumb',
      date_from: undefined,
      page_size: 100,
      enabled: true,
    });
    expect(screen.getByRole('heading', { name: 'History (1 of 5)' })).toBeInTheDocument();
    expect(cardTitles()).toEqual(['Recent plumbing (server)']);
  });

  it('falls back to filtering the unfiltered list when the server-filtered query has not succeeded', () => {
    h.filteredJobs = query(undefined, { isError: true });
    renderPage();
    fireEvent.change(selects().category, { target: { value: 'cat-plumb' } });
    expect(screen.getByRole('heading', { name: 'History (2 of 5)' })).toBeInTheDocument();
    expect(cardTitles()).toEqual(['Recent plumbing', 'Winter plumbing']);
  });

  it.each([
    ['30d', 30, ['Recent plumbing', 'Uncategorised']],
    ['90d', 90, ['Recent plumbing', 'Spring roofing', 'Uncategorised']],
    ['1y', 365, ['Recent plumbing', 'Spring roofing', 'Winter plumbing', 'Uncategorised']],
  ] as const)('applies the %s window as a date_from lower bound', (range, days, expected) => {
    renderPage();
    fireEvent.change(selects().dateRange, { target: { value: range } });

    const [, filtered] = lastJobQueries();
    expect(filtered).toEqual({
      property_id: 'p1',
      category_id: undefined,
      date_from: daysAgo(days),
      page_size: 100,
      enabled: true,
    });
    expect(cardTitles()).toEqual(expected);
    expect(
      screen.getByRole('heading', { name: `History (${String(expected.length)} of 5)` }),
    ).toBeInTheDocument();
  });

  it('drops jobs with an unparseable created_at once a date window is active', () => {
    h.mainJobs = query([
      job({ id: 'ok', title: 'Dated', created_at: daysAgo(3) }),
      job({ id: 'bad', title: 'Undated', created_at: 'not-a-date' }),
    ]);
    renderPage();
    expect(cardTitles()).toEqual(['Dated', 'Undated']);
    fireEvent.change(selects().dateRange, { target: { value: '30d' } });
    expect(cardTitles()).toEqual(['Dated']);
  });

  it('explains an empty filtered result and restores everything on clear', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'Clear history filters' })).not.toBeInTheDocument();

    fireEvent.change(selects().category, { target: { value: 'cat-elec' } });
    fireEvent.change(selects().dateRange, { target: { value: '30d' } });
    expect(screen.getByRole('heading', { name: 'History (0 of 5)' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'No history jobs match these filters. Clear category or date range to see all completed work.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear history filters' }));
    expect(screen.getByRole('heading', { name: 'History (5)' })).toBeInTheDocument();
    expect(cardTitles()).toHaveLength(5);
    expect(selects().category).toHaveValue('all');
    expect(selects().dateRange).toHaveValue('all');
    expect(lastJobQueries()[1].enabled).toBe(false);
  });

  it('clears only the category when "All categories" is re-selected', () => {
    renderPage();
    fireEvent.change(selects().category, { target: { value: 'cat-roof' } });
    expect(cardTitles()).toEqual(['Spring roofing']);
    fireEvent.change(selects().category, { target: { value: 'all' } });
    expect(screen.getByRole('heading', { name: 'History (5)' })).toBeInTheDocument();
    expect(lastJobQueries()[1]).toMatchObject({ category_id: undefined, enabled: false });
  });
});
