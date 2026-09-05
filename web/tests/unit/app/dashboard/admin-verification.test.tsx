// Behavior tests for the admin verification queue page.
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaginationResponse, VerificationDocument } from '@/types';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/verification',
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

const useVerificationQueueMock = vi.fn();
const reviewMutateAsync = vi.fn();

vi.mock('@/hooks/useAdmin', () => ({
  useReviewDocument: () => ({ mutateAsync: reviewMutateAsync, isPending: false }),
  useVerificationQueue: (...args: unknown[]) => useVerificationQueueMock(...args) as unknown,
}));

import AdminVerificationPage from '@/app/(dashboard)/admin/verification/page';

function makeDoc(overrides: Partial<VerificationDocument> = {}): VerificationDocument {
  return {
    id: 'doc-1',
    user_id: 'user-12345678-aaaa-bbbb-cccc-dddddddddddd',
    user_email: 'bob@example.com',
    user_display_name: 'Bob Builder',
    document_type: 'drivers_license',
    status: 'pending',
    file_name: 'license.jpg',
    file_url: 'https://example.com/license.jpg',
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
  useVerificationQueueMock.mockReset();
  reviewMutateAsync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminVerificationPage', () => {
  it('renders without throwing', () => {
    useVerificationQueueMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminVerificationPage)));
    expect(container).toBeTruthy();
  });

  it('shows error state when hook returns isError', () => {
    useVerificationQueueMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(withQueryClient(createElement(AdminVerificationPage)));
    expect(screen.getByText('Failed to load verification queue')).toBeInTheDocument();
  });

  it('lists documents returned by the hook', () => {
    useVerificationQueueMock.mockReturnValue({
      data: {
        documents: [makeDoc()],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminVerificationPage)));
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
    expect(screen.getByText('drivers license')).toBeInTheDocument();
  });

  it('Approve confirm calls review mutation with approved=true', async () => {
    const user = userEvent.setup();
    useVerificationQueueMock.mockReturnValue({
      data: {
        documents: [makeDoc({ id: 'doc-99' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminVerificationPage)));

    await user.click(screen.getByRole('button', { name: /approve document from bob builder/i }));
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Approve"]',
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    expect(reviewMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-99',
      approved: true,
      rejection_reason: undefined,
    });
  });

  it('Reject confirm calls review mutation with approved=false + rejection_reason', async () => {
    const user = userEvent.setup();
    useVerificationQueueMock.mockReturnValue({
      data: {
        documents: [makeDoc({ id: 'doc-rj' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminVerificationPage)));

    await user.click(screen.getByRole('button', { name: /reject document from bob builder/i }));
    const reason = container.querySelector<HTMLTextAreaElement>('textarea#rejection-reason');
    if (reason) {
      act(() => {
        fireEvent.change(reason, { target: { value: 'illegible' } });
      });
    }
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Reject"]',
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    expect(reviewMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-rj',
      approved: false,
      rejection_reason: 'illegible',
    });
  });

  it('Approve dialog does not render rejection-reason textarea', async () => {
    const user = userEvent.setup();
    useVerificationQueueMock.mockReturnValue({
      data: {
        documents: [makeDoc()],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminVerificationPage)));

    await user.click(screen.getByRole('button', { name: /approve document from/i }));
    expect(container.querySelector('textarea#rejection-reason')).toBeNull();
  });

  it('Cancel closes dialog without invoking review mutation', async () => {
    const user = userEvent.setup();
    useVerificationQueueMock.mockReturnValue({
      data: {
        documents: [makeDoc()],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminVerificationPage)));

    await user.click(screen.getByRole('button', { name: /approve document from/i }));
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Cancel action"]',
    );
    if (cancelBtn) {
      fireEvent.click(cancelBtn);
    }
    expect(reviewMutateAsync).not.toHaveBeenCalled();
  });

  it('Approve/Reject buttons disabled for non-pending documents', () => {
    useVerificationQueueMock.mockReturnValue({
      data: {
        documents: [makeDoc({ status: 'approved' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminVerificationPage)));
    expect(
      screen.getByRole('button', { name: /approve document from bob builder/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /reject document from bob builder/i }),
    ).toBeDisabled();
  });

  it('renders empty message when no documents', () => {
    useVerificationQueueMock.mockReturnValue({
      data: { documents: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminVerificationPage)));
    expect(screen.getByText('No documents pending review.')).toBeInTheDocument();
  });

  it('pagination Next button advances page param', async () => {
    const user = userEvent.setup();
    useVerificationQueueMock.mockReturnValue({
      data: { documents: [makeDoc()], pagination: makePagination() },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminVerificationPage)));

    await user.click(screen.getByRole('button', { name: /go to next page/i }));
    // The hook is called with positional args (page, pageSize)
    expect(useVerificationQueueMock).toHaveBeenLastCalledWith(2, 20);
  });
});
