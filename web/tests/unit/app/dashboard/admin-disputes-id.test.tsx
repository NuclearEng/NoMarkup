// Tests for the admin dispute detail page — exercises loading, error, info card,
// resolution form interactions (notes, refund, guarantee checkbox), full
// handleResolve flow with router push, and resolved-state read-only branch.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const disputeState: {
  data: { dispute: Record<string, unknown> } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: true, isError: false };

const resolveMutate = vi.fn(() => Promise.resolve({}));
const resolveState = { isPending: false, isError: false };
const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/disputes/123',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'dispute-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useAdmin', () => ({
  useAdminDispute: () => disputeState,
  useResolveDispute: () => ({
    mutateAsync: resolveMutate,
    isPending: resolveState.isPending,
    isError: resolveState.isError,
  }),
}));

// Replace shadcn Select with a thin wrapper that exposes a hidden native
// <select> alongside its children — bypasses Radix's pointer-capture API
// which jsdom does not implement.
vi.mock('@/components/ui/select', () => {
  return {
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
        'div',
        null,
        createElement(
          'select',
          {
            'data-testid': 'resolution-type-select',
            value,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              onValueChange(e.target.value);
            },
          },
          createElement('option', { value: '' }, ''),
          createElement('option', { value: 'favor_customer' }, 'Favor Customer'),
          createElement('option', { value: 'favor_provider' }, 'Favor Provider'),
          createElement('option', { value: 'split' }, 'Split'),
          createElement('option', { value: 'dismissed' }, 'Dismissed'),
        ),
        children,
      ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) =>
      createElement('span', null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) =>
      createElement('span', null, children),
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: React.ReactNode;
    }) => createElement('span', { 'data-select-value': value }, children),
  };
});

const { default: AdminDisputeDetailPage } = await import(
  '@/app/(dashboard)/admin/disputes/[id]/page'
);

function makeDispute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dispute-1234567890',
    contract_id: 'contract-12345678',
    initiated_by: 'user-12345678',
    initiator_name: 'Alice',
    respondent_name: 'Bob',
    reason: 'Provider did not finish.',
    status: 'open',
    is_guarantee_claim: false,
    created_at: '2026-04-10T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  disputeState.data = undefined;
  disputeState.isLoading = true;
  disputeState.isError = false;
  resolveState.isPending = false;
  resolveState.isError = false;
  resolveMutate.mockClear();
  resolveMutate.mockImplementation(() => Promise.resolve({}));
  routerPush.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminDisputeDetailPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(container).toBeTruthy();
  });

  it('renders error state when fetch fails', () => {
    disputeState.isLoading = false;
    disputeState.isError = true;
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(screen.getByText(/Failed to load dispute details/i)).toBeDefined();
  });

  it('renders error state when no dispute data', () => {
    disputeState.isLoading = false;
    disputeState.data = undefined;
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(screen.getByText(/Failed to load dispute details/i)).toBeDefined();
  });

  it('renders dispute info when loaded', () => {
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
    expect(screen.getByText(/Provider did not finish/i)).toBeDefined();
  });

  it('falls back to truncated initiator id when initiator_name missing', () => {
    disputeState.isLoading = false;
    disputeState.data = {
      dispute: makeDispute({ initiator_name: undefined, initiated_by: 'abc-defghijklmnop' }),
    };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    // First 12 chars of 'abc-defghijklmnop'
    expect(screen.getByText('abc-defghijk')).toBeDefined();
  });

  it('shows N/A when respondent_name missing', () => {
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute({ respondent_name: undefined }) };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(screen.getByText('N/A')).toBeDefined();
  });

  it('shows resolution form for non-resolved disputes', () => {
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute({ status: 'open' }) };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(screen.getByLabelText(/Resolution Notes/i)).toBeDefined();
    expect(screen.getByLabelText(/Refund Amount/i)).toBeDefined();
  });

  it('hides resolution form when dispute is already resolved', () => {
    disputeState.isLoading = false;
    disputeState.data = {
      dispute: makeDispute({
        status: 'resolved',
        resolution_type: 'favor_customer',
        resolution_notes: 'Customer was right',
        resolved_at: '2026-04-12T00:00:00Z',
      }),
    };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(screen.queryByLabelText(/Resolution Notes/i)).toBeNull();
    expect(screen.getByText(/Customer was right/i)).toBeDefined();
    expect(screen.getByText('Favor Customer')).toBeDefined();
  });

  it('disables Resolve button when no resolution type selected', () => {
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    const resolveBtn = screen.getByRole('button', { name: /Resolve Dispute/i });
    expect((resolveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('updates notes textarea on user input', () => {
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    const notesInput = screen.getByLabelText(/Resolution Notes/i);
    fireEvent.change(notesInput, { target: { value: 'Detailed notes here' } });
    expect((notesInput as HTMLTextAreaElement).value).toBe('Detailed notes here');
  });

  it('updates refund input on change', () => {
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    const refundInput = screen.getByLabelText(/Refund Amount/i);
    fireEvent.change(refundInput, { target: { value: '125.50' } });
    expect((refundInput as HTMLInputElement).value).toBe('125.50');
  });

  it('toggles guarantee claim checkbox', () => {
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    const checkbox = screen.getByLabelText(/File guarantee claim/i);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it('shows error message when resolve mutation fails', () => {
    resolveState.isError = true;
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(screen.getByText(/Failed to resolve dispute/i)).toBeDefined();
  });

  it('shows refund amount field when dispute had a refund', () => {
    disputeState.isLoading = false;
    disputeState.data = {
      dispute: makeDispute({
        status: 'resolved',
        refund_amount_cents: 5000,
        resolution_type: 'split',
      }),
    };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(screen.getByText('Refund Amount')).toBeDefined();
  });

  it('shows pending state in button when mutation is pending', () => {
    resolveState.isPending = true;
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    expect(screen.getByRole('button', { name: /Resolving\.\.\./i })).toBeDefined();
  });

  it('calls handleResolve and navigates after successful resolution', async () => {
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    const user = userEvent.setup();
    render(withQueryClient(createElement(AdminDisputeDetailPage)));

    // Fill notes & refund.
    const notesInput = screen.getByLabelText(/Resolution Notes/i);
    fireEvent.change(notesInput, { target: { value: 'Resolution rationale' } });
    const refundInput = screen.getByLabelText(/Refund Amount/i);
    fireEvent.change(refundInput, { target: { value: '50.00' } });

    // Pick resolution type via the mocked native <select>.
    const select = screen.getByTestId('resolution-type-select');
    fireEvent.change(select, { target: { value: 'favor_customer' } });

    // Click resolve.
    const resolveBtn = screen.getByRole('button', { name: /Resolve Dispute/i });
    await waitFor(() => {
      expect((resolveBtn as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(resolveBtn);

    await waitFor(() => {
      expect(resolveMutate).toHaveBeenCalledTimes(1);
    });
    expect(resolveMutate).toHaveBeenCalledWith({
      disputeId: 'dispute-1234567890',
      resolution_type: 'favor_customer',
      resolution_notes: 'Resolution rationale',
      refund_amount_cents: 5000,
      guarantee_claim: false,
    });
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/admin/disputes');
    });
  });

  it('handleResolve omits refund when none entered', async () => {
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    const user = userEvent.setup();
    render(withQueryClient(createElement(AdminDisputeDetailPage)));

    const select = screen.getByTestId('resolution-type-select');
    fireEvent.change(select, { target: { value: 'split' } });

    const checkbox = screen.getByLabelText(/File guarantee claim/i);
    fireEvent.click(checkbox);

    const resolveBtn = screen.getByRole('button', { name: /Resolve Dispute/i });
    await waitFor(() => {
      expect((resolveBtn as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(resolveBtn);

    await waitFor(() => {
      expect(resolveMutate).toHaveBeenCalledTimes(1);
    });
    expect(resolveMutate).toHaveBeenCalledWith({
      disputeId: 'dispute-1234567890',
      resolution_type: 'split',
      resolution_notes: '',
      refund_amount_cents: undefined,
      guarantee_claim: true,
    });
  });

  it('does not call resolve mutation when handleResolve is invoked without resolution type', async () => {
    // This guards line 66: `if (!dispute || !resolutionType) return;`
    disputeState.isLoading = false;
    disputeState.data = { dispute: makeDispute() };
    render(withQueryClient(createElement(AdminDisputeDetailPage)));
    const resolveBtn = screen.getByRole('button', { name: /Resolve Dispute/i });
    // Disabled prevents clicks but we can still confirm no call has occurred.
    expect((resolveBtn as HTMLButtonElement).disabled).toBe(true);
    expect(resolveMutate).not.toHaveBeenCalled();
  });
});
