// Behavior tests for the admin jobs management page.
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job, PaginationResponse } from '@/types';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/jobs',
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

const useAdminJobsMock = vi.fn();
const suspendMutateAsync = vi.fn();
const removeMutateAsync = vi.fn();

vi.mock('@/hooks/useAdmin', () => ({
  useAdminJobs: (...args: unknown[]) => useAdminJobsMock(...args) as unknown,
  useRemoveJob: () => ({ mutateAsync: removeMutateAsync, isPending: false }),
  useSuspendJob: () => ({ mutateAsync: suspendMutateAsync, isPending: false }),
}));

import AdminJobsPage from '@/app/(dashboard)/admin/jobs/page';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    customer_id: 'cust-1',
    category_id: 'cat-1',
    category_name: 'Plumbing',
    category_slug: 'plumbing',
    title: 'Fix leaky faucet',
    description: 'Kitchen sink',
    status: 'active',
    schedule_type: 'flexible',
    scheduled_date: null,
    is_recurring: false,
    recurrence_frequency: null,
    location_address: null,
    location_lat: null,
    location_lng: null,
    starting_bid_cents: null,
    offer_accepted_cents: null,
    auction_duration_hours: 24,
    auction_ends_at: null,
    bid_count: 3,
    lowest_bid_cents: 5000,
    market_range: null,
    auction_type: 'sealed',
    snipe_extension_count: 0,
    original_auction_ends_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePagination(overrides: Partial<PaginationResponse> = {}): PaginationResponse {
  return {
    totalCount: 40,
    page: 1,
    pageSize: 20,
    totalPages: 2,
    hasNext: true,
    ...overrides,
  };
}

beforeAll(() => {
  if (typeof HTMLDialogElement !== 'undefined') {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  }
});

beforeEach(() => {
  useAdminJobsMock.mockReset();
  suspendMutateAsync.mockReset().mockResolvedValue(undefined);
  removeMutateAsync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminJobsPage', () => {
  it('renders without throwing', () => {
    useAdminJobsMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    const { container } = render(withQueryClient(createElement(AdminJobsPage)));
    expect(container).toBeTruthy();
  });

  it('shows error state when hook returns isError', () => {
    useAdminJobsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(withQueryClient(createElement(AdminJobsPage)));
    expect(screen.getByText('Failed to load jobs')).toBeInTheDocument();
  });

  it('lists jobs returned by the hook', () => {
    useAdminJobsMock.mockReturnValue({
      data: { jobs: [makeJob()], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminJobsPage)));
    expect(screen.getByText('Fix leaky faucet')).toBeInTheDocument();
    expect(screen.getByText('Plumbing')).toBeInTheDocument();
  });

  it('clicking Suspend opens confirm dialog', async () => {
    const user = userEvent.setup();
    useAdminJobsMock.mockReturnValue({
      data: { jobs: [makeJob()], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminJobsPage)));

    await user.click(screen.getByRole('button', { name: /suspend job: fix leaky faucet/i }));
    const dialog = container.querySelector('dialog');
    expect(dialog).toBeTruthy();
    expect(container.querySelector('textarea#job-action-reason')).toBeTruthy();
  });

  it('Suspend confirm calls suspend mutation with jobId + reason', async () => {
    const user = userEvent.setup();
    useAdminJobsMock.mockReturnValue({
      data: {
        jobs: [makeJob({ id: 'j-77' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminJobsPage)));

    await user.click(screen.getByRole('button', { name: /suspend job:/i }));
    const reason = container.querySelector<HTMLTextAreaElement>('textarea#job-action-reason');
    if (reason) {
      act(() => {
        fireEvent.change(reason, { target: { value: 'policy violation' } });
      });
    }
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Suspend Job"]',
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    expect(suspendMutateAsync).toHaveBeenCalledWith({ jobId: 'j-77', reason: 'policy violation' });
  });

  it('Remove confirm calls remove mutation with jobId + reason', async () => {
    const user = userEvent.setup();
    useAdminJobsMock.mockReturnValue({
      data: {
        jobs: [makeJob({ id: 'j-rm' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminJobsPage)));

    await user.click(screen.getByRole('button', { name: /remove job:/i }));
    const reason = container.querySelector<HTMLTextAreaElement>('textarea#job-action-reason');
    if (reason) {
      act(() => {
        fireEvent.change(reason, { target: { value: 'spam' } });
      });
    }
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Remove Job"]',
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    expect(removeMutateAsync).toHaveBeenCalledWith({ jobId: 'j-rm', reason: 'spam' });
  });

  it('Cancel closes dialog without invoking mutations', async () => {
    const user = userEvent.setup();
    useAdminJobsMock.mockReturnValue({
      data: { jobs: [makeJob()], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminJobsPage)));

    await user.click(screen.getByRole('button', { name: /suspend job:/i }));
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Cancel action"]',
    );
    if (cancelBtn) {
      fireEvent.click(cancelBtn);
    }

    expect(suspendMutateAsync).not.toHaveBeenCalled();
  });

  it('confirm button is disabled until a reason is entered', async () => {
    const user = userEvent.setup();
    useAdminJobsMock.mockReturnValue({
      data: { jobs: [makeJob()], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminJobsPage)));

    await user.click(screen.getByRole('button', { name: /suspend job:/i }));
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Suspend Job"]',
    );
    expect(confirmBtn?.disabled).toBe(true);
  });

  it('Suspend button is disabled when job already suspended', () => {
    useAdminJobsMock.mockReturnValue({
      data: {
        jobs: [makeJob({ status: 'suspended' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminJobsPage)));
    expect(screen.getByRole('button', { name: /suspend job:/i })).toBeDisabled();
  });

  it('renders empty message when no jobs', () => {
    useAdminJobsMock.mockReturnValue({
      data: { jobs: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminJobsPage)));
    expect(
      screen.getByText('No jobs found matching the current filters.'),
    ).toBeInTheDocument();
  });

  it('renders -- for jobs with no lowest bid', () => {
    useAdminJobsMock.mockReturnValue({
      data: {
        jobs: [makeJob({ lowest_bid_cents: 0 })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminJobsPage)));
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('pagination Next button advances page param', async () => {
    const user = userEvent.setup();
    useAdminJobsMock.mockReturnValue({
      data: { jobs: [makeJob()], pagination: makePagination() },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminJobsPage)));

    await user.click(screen.getByRole('button', { name: /go to next page/i }));
    expect(useAdminJobsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });
});
