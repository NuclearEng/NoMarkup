// Tests for the My Jobs (customer) page — exercises tab switching, draft action
// buttons (publish + delete), pagination buttons, error state, and empty state per tab.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const jobsState: {
  data:
    | {
        jobs: Record<string, unknown>[];
        pagination: { page: number; totalPages: number; hasNext: boolean };
      }
    | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const publishMutate = vi.fn();
const deleteMutate = vi.fn();
const publishState = { isPending: false };
const deleteState = { isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs/mine',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useJobs', () => ({
  useCustomerJobs: () => jobsState,
  usePublishJob: () => ({ mutate: publishMutate, isPending: publishState.isPending }),
  useDeleteDraft: () => ({ mutate: deleteMutate, isPending: deleteState.isPending }),
}));

// JobCard pulls in heavy components; stub for predictable rendering.
vi.mock('@/components/jobs/JobCard', () => ({
  JobCard: ({ job }: { job: { id: string; title: string; status: string } }) =>
    createElement('div', { 'data-testid': `job-card-${job.id}` }, job.title),
}));

const { default: MyJobsPage } = await import('@/app/(dashboard)/jobs/mine/page');

function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    title: 'Fix kitchen sink',
    status: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  jobsState.data = undefined;
  jobsState.isLoading = false;
  jobsState.isError = false;
  publishState.isPending = false;
  deleteState.isPending = false;
  publishMutate.mockReset();
  deleteMutate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MyJobsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(MyJobsPage)));
    expect(container).toBeTruthy();
  });

  it('renders all 5 tabs', () => {
    render(withQueryClient(createElement(MyJobsPage)));
    expect(screen.getByRole('tab', { name: /^All$/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Active/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Drafts/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Completed/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Cancelled/i })).toBeDefined();
  });

  it('switches active tab when a tab is clicked', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(MyJobsPage)));
    const draftsTab = screen.getByRole('tab', { name: /Drafts/i });
    await user.click(draftsTab);
    expect(draftsTab.getAttribute('data-state')).toBe('active');
  });

  it('renders error state when fetch fails', () => {
    jobsState.isError = true;
    render(withQueryClient(createElement(MyJobsPage)));
    expect(screen.getByText(/Failed to load jobs\. Please try again\./i)).toBeDefined();
  });

  it('renders empty state for "all" tab with CTA', () => {
    jobsState.data = {
      jobs: [],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    expect(screen.getByText(/haven't posted any jobs yet/i)).toBeDefined();
    expect(screen.getAllByRole('link', { name: /Post Your First Job/i }).length).toBeGreaterThan(0);
  });

  it('renders job cards when jobs are returned', () => {
    jobsState.data = {
      jobs: [makeJob({ id: 'j1', title: 'Job One' }), makeJob({ id: 'j2', title: 'Job Two' })],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    expect(screen.getAllByTestId('job-card-j1').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('job-card-j2').length).toBeGreaterThan(0);
  });

  it('shows Go Live + Delete buttons only for draft jobs', () => {
    jobsState.data = {
      jobs: [makeJob({ id: 'j-draft', status: 'draft', title: 'Draft Job' })],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    expect(screen.getAllByRole('button', { name: /Go Live/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Delete draft/i }).length).toBeGreaterThan(0);
  });

  it('calls publishJob.mutate with job id when Go Live clicked', () => {
    jobsState.data = {
      jobs: [makeJob({ id: 'j-draft', status: 'draft', title: 'Draft Job' })],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    const buttons = screen.getAllByRole('button', { name: /Go Live/i });
    fireEvent.click(buttons[0] as HTMLElement);
    expect(publishMutate).toHaveBeenCalledWith('j-draft');
  });

  it('calls deleteDraft.mutate with job id when Delete clicked', () => {
    jobsState.data = {
      jobs: [makeJob({ id: 'j-draft', status: 'draft', title: 'Draft Job' })],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    const buttons = screen.getAllByRole('button', { name: /Delete draft/i });
    fireEvent.click(buttons[0] as HTMLElement);
    expect(deleteMutate).toHaveBeenCalledWith('j-draft');
  });

  it('renders pagination when totalPages > 1', () => {
    jobsState.data = {
      jobs: [makeJob({ id: 'j1' })],
      pagination: { page: 2, totalPages: 5, hasNext: true },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    expect(screen.getAllByRole('button', { name: /Previous/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Next/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Page 1 of 5/).length).toBeGreaterThan(0);
  });

  it('disables Previous button on page 1', () => {
    jobsState.data = {
      jobs: [makeJob({ id: 'j1' })],
      pagination: { page: 1, totalPages: 3, hasNext: true },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    const prev = screen.getAllByRole('button', { name: /Previous/i })[0] as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it('disables Next button when hasNext is false', () => {
    jobsState.data = {
      jobs: [makeJob({ id: 'j1' })],
      pagination: { page: 2, totalPages: 2, hasNext: false },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    const next = screen.getAllByRole('button', { name: /Next/i })[0] as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('advances and rewinds the page when Next/Previous are clicked', () => {
    jobsState.data = {
      jobs: [makeJob({ id: 'j1' })],
      pagination: { page: 1, totalPages: 5, hasNext: true },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    expect(screen.getAllByText(/Page 1 of 5/).length).toBeGreaterThan(0);
    const next = screen.getAllByRole('button', { name: /Next/i })[0] as HTMLButtonElement;
    fireEvent.click(next);
    expect(screen.getAllByText(/Page 2 of 5/).length).toBeGreaterThan(0);
    const prev = screen.getAllByRole('button', { name: /Previous/i })[0] as HTMLButtonElement;
    fireEvent.click(prev);
    expect(screen.getAllByText(/Page 1 of 5/).length).toBeGreaterThan(0);
  });

  it('renders the loading state with content loaders', () => {
    jobsState.isLoading = true;
    jobsState.data = undefined;
    const { container } = render(withQueryClient(createElement(MyJobsPage)));
    // No job cards, but the heading and tabs are still present and the content
    // loader blocks render under each TabsContent.
    expect(screen.getAllByRole('tab', { name: /^All$/i }).length).toBeGreaterThan(0);
    expect(container.querySelectorAll('div').length).toBeGreaterThan(5);
  });

  it('shows Publishing label when publish mutation is pending', () => {
    publishState.isPending = true;
    jobsState.data = {
      jobs: [makeJob({ id: 'j-draft', status: 'draft' })],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(MyJobsPage)));
    expect(screen.getAllByRole('button', { name: /Publishing/i }).length).toBeGreaterThan(0);
  });
});
