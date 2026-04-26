// Behavior tests for the admin guarantee claims list page.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Dispute, PaginationResponse } from '@/types';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/guarantee',
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

const useAdminGuaranteeClaimsMock = vi.fn();

vi.mock('@/hooks/useGuarantee', () => ({
  useAdminGuaranteeClaims: (...args: unknown[]) => useAdminGuaranteeClaimsMock(...args) as unknown,
}));

import AdminGuaranteePage from '@/app/(dashboard)/admin/guarantee/page';

function makeClaim(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'claim-12345678-aaaa-bbbb-cccc-dddddddddddd',
    contract_id: 'contract-12345678-aaaa-bbbb-cccc-dddddddddddd',
    initiated_by: 'user-12345678',
    initiator_name: 'Carol Customer',
    reason: 'Provider did not show up',
    status: 'open',
    refund_amount_cents: 12500,
    is_guarantee_claim: true,
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

beforeEach(() => {
  useAdminGuaranteeClaimsMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminGuaranteePage', () => {
  it('renders without throwing', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(container).toBeTruthy();
  });

  it('shows error state when hook returns isError', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(screen.getByText('Failed to load guarantee claims')).toBeInTheDocument();
  });

  it('renders claims returned by the hook', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: {
        guarantee_claims: [makeClaim()],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(screen.getByText('Carol Customer')).toBeInTheDocument();
    expect(screen.getByText('Provider did not show up')).toBeInTheDocument();
  });

  it('queries with no status filter on initial mount', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: {
        guarantee_claims: [],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(useAdminGuaranteeClaimsMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined, page: 1, page_size: 20 }),
    );
  });

  it('renders status badge with mapped label', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: {
        guarantee_claims: [makeClaim({ status: 'investigating' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(screen.getByText('Investigating')).toBeInTheDocument();
  });

  it('renders -- when refund_amount_cents is missing', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: {
        guarantee_claims: [makeClaim({ refund_amount_cents: 0 })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('renders Review button as link to claim detail page', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: {
        guarantee_claims: [makeClaim()],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    const reviewBtn = screen.getByRole('button', { name: /review/i });
    expect(reviewBtn).toBeInTheDocument();
    // Wrapped in an anchor tag pointing to the claim detail
    const anchor = reviewBtn.closest('a');
    expect(anchor?.getAttribute('href')).toContain('/admin/guarantee/');
  });

  it('falls back to truncated initiated_by when initiator_name is missing', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: {
        guarantee_claims: [
          makeClaim({ initiator_name: undefined, initiated_by: 'abcdef1234567890' }),
        ],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(screen.getByText('abcdef12')).toBeInTheDocument();
  });

  it('renders empty message when there are no claims', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: {
        guarantee_claims: [],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(
      screen.getByText('No guarantee claims found matching the current filters.'),
    ).toBeInTheDocument();
  });

  it('pagination Next button advances page param', async () => {
    const user = userEvent.setup();
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: { guarantee_claims: [makeClaim()], pagination: makePagination() },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));

    await user.click(screen.getByRole('button', { name: /go to next page/i }));
    expect(useAdminGuaranteeClaimsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it('Previous button is disabled on the first page', () => {
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: { guarantee_claims: [makeClaim()], pagination: makePagination() },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    expect(screen.getByRole('button', { name: /go to previous page/i })).toBeDisabled();
  });

  it('changes status filter via Select trigger and option click', () => {
    // The Select's onValueChange (lines 161-164) only fires through Radix —
    // open the combobox, then click an option.
    useAdminGuaranteeClaimsMock.mockReturnValue({
      data: { guarantee_claims: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminGuaranteePage)));
    const trigger = screen.getByRole('combobox', { name: /filter claims by status/i });
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: /^Investigating$/i });
    fireEvent.click(option);
    fireEvent.click(trigger);
    const allOption = screen.getByRole('option', { name: /All Statuses/i });
    fireEvent.click(allOption);
    // Switching back to All Statuses sets status to undefined.
    expect(useAdminGuaranteeClaimsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined, page: 1 }),
    );
  });
});
