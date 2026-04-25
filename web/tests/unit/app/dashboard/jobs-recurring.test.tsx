// Tests for the recurring jobs management page — exercises loading, error,
// empty, and populated branches plus pause/cancel interactions.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const jobsState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const refetch = vi.fn();
const updateJobMutate = vi.fn();
const cancelJobMutate = vi.fn();
const updateState = { isPending: false };
const cancelStateMutation = { isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs/recurring',
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
  useCancelJob: () => ({
    mutate: cancelJobMutate,
    isPending: cancelStateMutation.isPending,
  }),
  useCustomerJobs: () => ({
    data: jobsState.data,
    isLoading: jobsState.isLoading,
    isError: jobsState.isError,
    refetch,
  }),
  useUpdateJob: () => ({
    mutate: updateJobMutate,
    isPending: updateState.isPending,
  }),
}));

const { default: RecurringJobsPage } = await import(
  '@/app/(dashboard)/jobs/recurring/page'
);

const monthly = {
  id: 'job_monthly',
  title: 'Monthly Lawn Care',
  category_name: 'Landscaping',
  status: 'active',
  is_recurring: true,
  recurrence_frequency: 'monthly',
  scheduled_date: '2025-05-15T00:00:00Z',
  starting_bid_cents: 8000,
};
const weekly = {
  id: 'job_weekly',
  title: 'Weekly Pool Cleaning',
  category_name: 'Pool',
  status: 'in_progress',
  is_recurring: true,
  recurrence_frequency: 'weekly',
  scheduled_date: '2025-05-15T00:00:00Z',
  starting_bid_cents: 5000,
};
const oneOff = {
  id: 'job_oneoff',
  title: 'One-Time Repair',
  category_name: 'Repair',
  status: 'open',
  is_recurring: false,
  recurrence_frequency: null,
  scheduled_date: null,
  starting_bid_cents: 12000,
};

beforeEach(() => {
  jobsState.data = undefined;
  jobsState.isLoading = false;
  jobsState.isError = false;
  updateState.isPending = false;
  cancelStateMutation.isPending = false;
  refetch.mockClear();
  updateJobMutate.mockClear();
  cancelJobMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RecurringJobsPage', () => {
  it('renders loading state while jobs are fetching', () => {
    jobsState.isLoading = true;
    render(withQueryClient(createElement(RecurringJobsPage)));
    expect(screen.queryByText(/no recurring jobs/i)).toBeNull();
    expect(screen.queryByText(/total recurring/i)).toBeNull();
  });

  it('renders error state with retry action when fetch fails', () => {
    jobsState.isError = true;
    render(withQueryClient(createElement(RecurringJobsPage)));
    expect(screen.getByText(/failed to load recurring jobs/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when no recurring jobs exist', () => {
    jobsState.data = { jobs: [oneOff] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    expect(screen.getByText(/no recurring jobs/i)).toBeDefined();
    expect(screen.getByRole('link', { name: /post a recurring job/i })).toBeDefined();
  });

  it('renders summary cards reflecting active counts and most-common frequency', () => {
    jobsState.data = { jobs: [monthly, weekly, oneOff] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    expect(screen.getByText('Total Recurring')).toBeDefined();
    expect(screen.getByText('Most Common')).toBeDefined();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
  });

  it('renders one card per recurring job with title, frequency, and price', () => {
    jobsState.data = { jobs: [monthly, weekly] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    expect(screen.getByRole('link', { name: 'Monthly Lawn Care' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Weekly Pool Cleaning' })).toBeDefined();
    expect(screen.getAllByText('Monthly').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Weekly').length).toBeGreaterThan(0);
  });

  it('toggles pause state and dispatches update mutation', () => {
    jobsState.data = { jobs: [monthly] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    const pauseBtn = screen.getByRole('button', { name: /pause recurring job/i });
    fireEvent.click(pauseBtn);
    expect(updateJobMutate).toHaveBeenCalledTimes(1);
    const args = updateJobMutate.mock.calls[0]?.[0] as { id: string; input: { is_recurring: boolean } };
    expect(args.id).toBe('job_monthly');
    expect(args.input.is_recurring).toBe(false);
    expect(screen.getByText('Paused')).toBeDefined();
  });

  it('dispatches cancel mutation when cancel button clicked', () => {
    jobsState.data = { jobs: [monthly] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    fireEvent.click(screen.getByRole('button', { name: /cancel recurring job/i }));
    expect(cancelJobMutate).toHaveBeenCalledWith('job_monthly');
  });

  it('disables update button while update mutation is pending', () => {
    jobsState.data = { jobs: [monthly] };
    updateState.isPending = true;
    render(withQueryClient(createElement(RecurringJobsPage)));
    const pauseBtn = screen.getByRole('button', { name: /pause recurring job/i });
    expect(pauseBtn.hasAttribute('disabled')).toBe(true);
  });

  it('renders header link to post a new job', () => {
    jobsState.data = { jobs: [monthly] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    expect(screen.getByRole('button', { name: /post new job/i })).toBeDefined();
  });
});
