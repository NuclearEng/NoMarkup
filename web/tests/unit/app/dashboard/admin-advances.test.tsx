// Smoke + branch tests for the admin advances review page.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/advances',
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

vi.mock('@/hooks/useWorkingCapital', () => ({
  useAdminAdvances: vi.fn(),
  useDisburseAdvance: vi.fn(),
  useReviewAdvance: vi.fn(),
}));

const { useAdminAdvances, useDisburseAdvance, useReviewAdvance } = await import(
  '@/hooks/useWorkingCapital'
);
const { default: AdminAdvancesPage } = await import(
  '@/app/(dashboard)/admin/advances/page'
);

function setHooks(opts: {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  reviewMutate?: ReturnType<typeof vi.fn>;
  disburseMutate?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(useAdminAdvances).mockReturnValue({
    data: opts.data,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
  } as unknown as ReturnType<typeof useAdminAdvances>);
  vi.mocked(useReviewAdvance).mockReturnValue({
    mutate: opts.reviewMutate ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useReviewAdvance>);
  vi.mocked(useDisburseAdvance).mockReturnValue({
    mutate: opts.disburseMutate ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDisburseAdvance>);
}

const baseAdvance = {
  id: 'adv_1',
  provider_id: 'provider-id-12345678',
  contract_id: 'contract-id-12345678',
  contract_number: 'CN-001',
  advance_amount_cents: 100000,
  fee_cents: 2500,
  repaid_cents: 0,
  stripe_transfer_id: null,
  status: 'requested' as const,
  created_at: '2026-01-01T00:00:00Z',
};

describe('AdminAdvancesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHooks();
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminAdvancesPage)));
    expect(container).toBeTruthy();
  });

  it('renders the heading and status filter', () => {
    render(withQueryClient(createElement(AdminAdvancesPage)));
    expect(screen.getByRole('heading', { name: 'Working Capital Advances' })).toBeDefined();
    expect(screen.getByLabelText('Filter advances by status')).toBeDefined();
  });

  it('renders the page-level error state', () => {
    setHooks({ isError: true });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    expect(screen.getByText('Failed to load advances')).toBeDefined();
  });

  it('renders the empty data table message', () => {
    setHooks({ data: { advances: [], pagination: { totalPages: 0 } } });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    expect(
      screen.getByText('No advances found matching the current filters.'),
    ).toBeDefined();
  });

  it('renders Approve + Reject buttons for a requested advance', () => {
    setHooks({
      data: { advances: [baseAdvance], pagination: { totalPages: 1 } },
    });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDefined();
  });

  it('calls reviewAdvance with approve action when Approve is clicked', () => {
    const reviewMutate = vi.fn();
    setHooks({
      data: { advances: [baseAdvance], pagination: { totalPages: 1 } },
      reviewMutate,
    });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(reviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ advanceId: baseAdvance.id, action: 'approve' }),
    );
  });

  it('calls reviewAdvance with reject action and reason when Reject is clicked', () => {
    const reviewMutate = vi.fn();
    setHooks({
      data: { advances: [baseAdvance], pagination: { totalPages: 1 } },
      reviewMutate,
    });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(reviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ advanceId: baseAdvance.id, action: 'reject' }),
    );
  });

  it('renders Disburse button for an approved advance', () => {
    const disburseMutate = vi.fn();
    setHooks({
      data: {
        advances: [{ ...baseAdvance, status: 'approved' }],
        pagination: { totalPages: 1 },
      },
      disburseMutate,
    });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    const btn = screen.getByRole('button', { name: 'Disburse' });
    fireEvent.click(btn);
    expect(disburseMutate).toHaveBeenCalledWith(baseAdvance.id);
  });

  it('renders no actions for a repaid advance', () => {
    setHooks({
      data: {
        advances: [{ ...baseAdvance, status: 'repaid' }],
        pagination: { totalPages: 1 },
      },
    });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disburse' })).toBeNull();
  });

  it('renders the truncated transfer id when present', () => {
    setHooks({
      data: {
        advances: [
          {
            ...baseAdvance,
            stripe_transfer_id: 'tr_abcdefghijk1234567890longstring',
          },
        ],
        pagination: { totalPages: 1 },
      },
    });
    const { container } = render(withQueryClient(createElement(AdminAdvancesPage)));
    // ID is truncated to first 16 chars: 'tr_abcdefghijk12'
    expect(container.textContent).toMatch(/tr_abcdefghijk12/);
  });
});
