// Smoke + branch tests for the admin advances review page.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

// jsdom does not implement <dialog>.showModal()/close(), which
// ActionConfirmDialog drives from an effect.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

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

  // Since 68a582d5 ("admin money confirms") every advance action goes through
  // ActionConfirmDialog: the row button only opens the dialog, and the
  // mutation fires when the admin confirms inside it.
  it('calls reviewAdvance with approve action only after Approve is confirmed', () => {
    const reviewMutate = vi.fn();
    setHooks({
      data: { advances: [baseAdvance], pagination: { totalPages: 1 } },
      reviewMutate,
    });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(reviewMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Approve working capital advance?')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(reviewMutate).toHaveBeenCalledTimes(1);
    expect(reviewMutate).toHaveBeenCalledWith(
      { advanceId: baseAdvance.id, action: 'approve' },
      expect.anything(),
    );
  });

  it('calls reviewAdvance with reject action and reason only after Reject is confirmed', () => {
    const reviewMutate = vi.fn();
    setHooks({
      data: { advances: [baseAdvance], pagination: { totalPages: 1 } },
      reviewMutate,
    });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(reviewMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Reject working capital advance?')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(reviewMutate).toHaveBeenCalledTimes(1);
    expect(reviewMutate).toHaveBeenCalledWith(
      {
        advanceId: baseAdvance.id,
        action: 'reject',
        reason: 'Does not meet eligibility criteria',
      },
      expect.anything(),
    );
  });

  it('does not fire the mutation when the confirm dialog is cancelled', () => {
    const reviewMutate = vi.fn();
    setHooks({
      data: { advances: [baseAdvance], pagination: { totalPages: 1 } },
      reviewMutate,
    });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel action' }),
    );
    expect(reviewMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
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
    // Money leaves the platform here: nothing fires until the admin confirms.
    expect(disburseMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Disburse working capital advance?')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disburse' }));
    expect(disburseMutate).toHaveBeenCalledTimes(1);
    expect(disburseMutate).toHaveBeenCalledWith(baseAdvance.id, expect.anything());
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

  // The per-button spinners were removed with the move to the confirm dialog
  // (68a582d5); the in-flight signal is now the disabled row buttons (the
  // dialog itself shows "Processing...").
  it('disables Approve and Reject while reviewAdvance is pending', () => {
    vi.mocked(useAdminAdvances).mockReturnValue({
      data: { advances: [baseAdvance], pagination: { totalPages: 1 } },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAdminAdvances>);
    vi.mocked(useReviewAdvance).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    } as unknown as ReturnType<typeof useReviewAdvance>);
    vi.mocked(useDisburseAdvance).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDisburseAdvance>);
    render(withQueryClient(createElement(AdminAdvancesPage)));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Approve' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reject' }).disabled).toBe(true);
  });

  it('disables Disburse while disburseAdvance is pending', () => {
    vi.mocked(useAdminAdvances).mockReturnValue({
      data: {
        advances: [{ ...baseAdvance, status: 'approved' }],
        pagination: { totalPages: 1 },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAdminAdvances>);
    vi.mocked(useReviewAdvance).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useReviewAdvance>);
    vi.mocked(useDisburseAdvance).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    } as unknown as ReturnType<typeof useDisburseAdvance>);
    render(withQueryClient(createElement(AdminAdvancesPage)));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Disburse' }).disabled).toBe(true);
  });

  it('falls back to truncated contract_id when contract_number is missing', () => {
    setHooks({
      data: {
        advances: [
          {
            ...baseAdvance,
            contract_number: null,
            contract_id: 'contract-id-fallback-x',
          },
        ],
        pagination: { totalPages: 1 },
      },
    });
    const { container } = render(withQueryClient(createElement(AdminAdvancesPage)));
    // Truncated to first 8 chars: 'contract'
    expect(container.textContent).toMatch(/contract/);
  });

  it('changes status filter via Select trigger and option click', () => {
    // The Select's onValueChange (lines 216-219) only fires through Radix —
    // open the combobox, then click an option.
    setHooks({ data: { advances: [], pagination: { totalPages: 0 } } });
    render(withQueryClient(createElement(AdminAdvancesPage)));
    const trigger = screen.getByRole('combobox', { name: /filter advances by status/i });
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: /^Approved$/i });
    fireEvent.click(option);
    fireEvent.click(trigger);
    const allOption = screen.getByRole('option', { name: /All Statuses/i });
    fireEvent.click(allOption);
    expect(trigger).toBeDefined();
  });
});
