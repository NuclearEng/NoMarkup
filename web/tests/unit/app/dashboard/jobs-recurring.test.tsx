// Tests for the recurring jobs management page — exercises loading, error,
// empty, and populated branches plus pause/cancel interactions.
import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it('reverts paused state when the update mutation reports an error', () => {
    jobsState.data = { jobs: [monthly] };
    // Capture mutate args so we can drive its onError callback.
    let capturedOpts: { onError?: () => void } | undefined;
    updateJobMutate.mockImplementation((_input, opts) => {
      capturedOpts = opts as { onError?: () => void };
    });
    render(withQueryClient(createElement(RecurringJobsPage)));
    fireEvent.click(screen.getByRole('button', { name: /pause recurring job/i }));
    // After click, badge shows Paused.
    expect(screen.getByText('Paused')).toBeDefined();
    // Trigger the onError callback to revert.
    expect(capturedOpts?.onError).toBeTypeOf('function');
    act(() => {
      capturedOpts?.onError?.();
    });
    // Now the resume button should be back.
    expect(screen.getByRole('button', { name: /pause recurring job/i })).toBeDefined();
  });

  it('renders job card without price when starting_bid_cents is absent', () => {
    const monthlyNoBid = { ...monthly, id: 'job_no_bid', starting_bid_cents: 0 };
    jobsState.data = { jobs: [monthlyNoBid] };
    const { container } = render(withQueryClient(createElement(RecurringJobsPage)));
    // Card renders; no price element with $ formatting beyond the count card.
    expect(container.textContent).not.toContain('$0.00');
    expect(screen.getByRole('link', { name: 'Monthly Lawn Care' })).toBeDefined();
  });

  it('computes next occurrence for biweekly frequency with past scheduled date', () => {
    const past = new Date();
    past.setMonth(past.getMonth() - 1);
    const biweekly = {
      ...monthly,
      id: 'job_biweekly',
      title: 'Biweekly Job',
      recurrence_frequency: 'biweekly',
      scheduled_date: past.toISOString(),
    };
    jobsState.data = { jobs: [biweekly] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    expect(screen.getAllByText(/Bi-weekly/i).length).toBeGreaterThan(0);
    // Some "Next:" text rendered; concrete date varies.
    expect(screen.getByText(/Next:/)).toBeDefined();
  });

  it('computes next occurrence for quarterly frequency with past scheduled date', () => {
    const past = new Date();
    past.setMonth(past.getMonth() - 6);
    const quarterly = {
      ...monthly,
      id: 'job_quarterly',
      title: 'Quarterly Job',
      recurrence_frequency: 'quarterly',
      scheduled_date: past.toISOString(),
    };
    jobsState.data = { jobs: [quarterly] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    // Frequency badge contains "Quarterly".
    expect(screen.getAllByText(/Quarterly/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Next:/)).toBeDefined();
  });

  it('falls back to monthly default when frequency is unknown and date is past', () => {
    const past = new Date();
    past.setMonth(past.getMonth() - 2);
    const unknown = {
      ...monthly,
      id: 'job_unknown',
      title: 'Unknown Job',
      recurrence_frequency: 'yearly',
      scheduled_date: past.toISOString(),
    };
    jobsState.data = { jobs: [unknown] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    // Frequency label maps to "Unknown" because not in FREQUENCY_LABELS.
    expect(screen.getByText('Unknown')).toBeDefined();
    expect(screen.getByText(/Next:/)).toBeDefined();
  });

  it('displays "Not scheduled" when job has no scheduled_date', () => {
    const noDate = {
      ...monthly,
      id: 'job_no_date',
      title: 'No Date Job',
      scheduled_date: null,
    };
    jobsState.data = { jobs: [noDate] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    expect(screen.getByText(/Not scheduled/)).toBeDefined();
  });

  it('renders the future scheduled date directly when scheduled > now', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const futureJob = {
      ...monthly,
      id: 'job_future',
      title: 'Future Job',
      scheduled_date: future.toISOString(),
    };
    jobsState.data = { jobs: [futureJob] };
    render(withQueryClient(createElement(RecurringJobsPage)));
    // The card should mention "Next:" with a date string for the future date.
    expect(screen.getByText(/Next:/)).toBeDefined();
  });
});
