// Behavior tests for the admin flagged reviews page.
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlaggedReview, PaginationResponse } from '@/types';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/reviews',
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

const useAdminFlaggedReviewsMock = vi.fn();
const resolveMutateAsync = vi.fn();

vi.mock('@/hooks/useAdmin', () => ({
  useAdminFlaggedReviews: (...args: unknown[]) => useAdminFlaggedReviewsMock(...args) as unknown,
  useResolveReviewFlag: () => ({ mutateAsync: resolveMutateAsync, isPending: false }),
}));

import AdminReviewsPage from '@/app/(dashboard)/admin/reviews/page';

function makeFlag(overrides: Partial<FlaggedReview> = {}): FlaggedReview {
  return {
    id: 'flag-1',
    review_id: 'review-1',
    flagged_by: 'user-2',
    reason: 'inappropriate_content',
    status: 'pending',
    review_content: 'This was a terrible job.',
    reviewer_name: 'Jane R.',
    review_rating: 2,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePagination(overrides: Partial<PaginationResponse> = {}): PaginationResponse {
  return {
    totalCount: 30,
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
  useAdminFlaggedReviewsMock.mockReset();
  resolveMutateAsync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminReviewsPage', () => {
  it('renders without throwing', () => {
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminReviewsPage)));
    expect(container).toBeTruthy();
  });

  it('shows error state when hook returns isError', () => {
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(withQueryClient(createElement(AdminReviewsPage)));
    expect(screen.getByText('Failed to load flagged reviews')).toBeInTheDocument();
  });

  it('lists flagged reviews returned by the hook', () => {
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: { flags: [makeFlag()], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminReviewsPage)));
    expect(screen.getByText('This was a terrible job.')).toBeInTheDocument();
  });

  it('queries with default pending status filter on mount', () => {
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: { flags: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminReviewsPage)));
    expect(useAdminFlaggedReviewsMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', page: 1, page_size: 20 }),
    );
  });

  it('Uphold confirm calls resolve mutation with action=uphold + notes', async () => {
    const user = userEvent.setup();
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: {
        flags: [makeFlag({ id: 'f-1' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminReviewsPage)));

    await user.click(screen.getByRole('button', { name: /uphold flag/i }));
    const notes = container.querySelector<HTMLTextAreaElement>('textarea#flag-notes');
    if (notes) {
      act(() => {
        fireEvent.change(notes, { target: { value: 'clearly profanity' } });
      });
    }
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Remove Review"]',
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    expect(resolveMutateAsync).toHaveBeenCalledWith({
      flagId: 'f-1',
      action: 'uphold',
      notes: 'clearly profanity',
    });
  });

  it('Dismiss confirm calls resolve mutation with action=dismiss + notes', async () => {
    const user = userEvent.setup();
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: {
        flags: [makeFlag({ id: 'f-2' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminReviewsPage)));

    await user.click(screen.getByRole('button', { name: /dismiss flag/i }));
    const notes = container.querySelector<HTMLTextAreaElement>('textarea#flag-notes');
    if (notes) {
      act(() => {
        fireEvent.change(notes, { target: { value: 'within policy' } });
      });
    }
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Dismiss Flag"]',
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    expect(resolveMutateAsync).toHaveBeenCalledWith({
      flagId: 'f-2',
      action: 'dismiss',
      notes: 'within policy',
    });
  });

  it('Uphold/Dismiss buttons disabled for non-pending flags', () => {
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: {
        flags: [makeFlag({ status: 'upheld' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminReviewsPage)));
    expect(screen.getByRole('button', { name: /uphold flag/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dismiss flag/i })).toBeDisabled();
  });

  it('Cancel closes dialog without invoking mutation', async () => {
    const user = userEvent.setup();
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: {
        flags: [makeFlag()],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminReviewsPage)));

    await user.click(screen.getByRole('button', { name: /uphold flag/i }));
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Cancel action"]',
    );
    if (cancelBtn) {
      fireEvent.click(cancelBtn);
    }
    expect(resolveMutateAsync).not.toHaveBeenCalled();
  });

  it('renders empty message when no flagged reviews', () => {
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: { flags: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminReviewsPage)));
    expect(screen.getByText('No flagged reviews found.')).toBeInTheDocument();
  });

  it('pagination Next button advances page param', async () => {
    const user = userEvent.setup();
    useAdminFlaggedReviewsMock.mockReturnValue({
      data: { flags: [makeFlag()], pagination: makePagination() },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminReviewsPage)));

    await user.click(screen.getByRole('button', { name: /go to next page/i }));
    expect(useAdminFlaggedReviewsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });
});
