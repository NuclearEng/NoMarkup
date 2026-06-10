// Tests for the admin Goods Disputes panel — the resolution UI that was
// previously orphaned (the useAdminGoodsDisputes / useResolveGoodsDispute hooks
// had zero consumers). Verifies a dispute renders, the resolve form submits the
// right payload per resolution, partial-refund validation, terminal-state hiding,
// and that a 409 ("already resolved") surfaces via toast.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => { toastSuccess(...args); },
    error: (...args: unknown[]) => { toastError(...args); },
  },
}));

const useAdminGoodsDisputes = vi.fn();
const resolveMutate = vi.fn();
const resolveState = { isPending: false };

vi.mock('@/hooks/useAdmin', () => ({
  useAdminGoodsDisputes: (...args: unknown[]) => useAdminGoodsDisputes(...args) as unknown,
  useResolveGoodsDispute: () => ({ mutate: resolveMutate, isPending: resolveState.isPending }),
}));

vi.mock('@/components/ui/animated-illustration', () => ({
  AnimatedIllustration: () => createElement('div', { 'data-testid': 'illustration' }),
}));

import { GoodsDisputesPanel } from '@/components/admin/GoodsDisputesPanel';
import type { AdminGoodsDispute } from '@/hooks/useAdmin';
import { ApiError } from '@/lib/api';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function renderPanel() {
  return render(createElement(GoodsDisputesPanel), { wrapper: createWrapper() });
}

const openDispute: AdminGoodsDispute = {
  id: '00000000-0000-0000-0000-000000000001',
  listing_order_id: 'order-1',
  listing_id: 'listing-1',
  listing_title: 'Vintage Drill Press',
  opened_by: 'buyer-abcdef12',
  opened_by_email: 'buyer@example.com',
  dispute_type: 'item_not_as_described',
  description: 'Arrived with a cracked base.',
  status: 'open',
  amount_cents: 12000,
  created_at: '2026-06-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveState.isPending = false;
});

afterEach(() => {
  useAdminGoodsDisputes.mockReset();
});

describe('GoodsDisputesPanel', () => {
  it('renders the loading state', () => {
    useAdminGoodsDisputes.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPanel();
    expect(screen.getByLabelText('Loading goods disputes')).toBeInTheDocument();
  });

  it('renders the error state', () => {
    useAdminGoodsDisputes.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPanel();
    expect(screen.getByText('Failed to load goods disputes')).toBeInTheDocument();
  });

  it('renders the empty state', () => {
    useAdminGoodsDisputes.mockReturnValue({
      data: { disputes: [] },
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('No goods disputes')).toBeInTheDocument();
  });

  it('renders a dispute with buyer, listing, amount, and a resolve form', () => {
    useAdminGoodsDisputes.mockReturnValue({
      data: { disputes: [openDispute] },
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('Vintage Drill Press')).toBeInTheDocument();
    expect(screen.getByText('buyer@example.com')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
    expect(screen.getByText('Arrived with a cracked base.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resolve dispute/i })).toBeInTheDocument();
  });

  it('submits a full refund with the right payload', async () => {
    useAdminGoodsDisputes.mockReturnValue({
      data: { disputes: [openDispute] },
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /Resolve dispute/i }));

    expect(resolveMutate).toHaveBeenCalledTimes(1);
    const [payload] = resolveMutate.mock.calls[0] as [Record<string, unknown>];
    expect(payload.disputeId).toBe(openDispute.id);
    expect(payload.resolution).toBe('refund_full');
    expect(payload.refund_to_buyer_cents).toBe(0);
    expect(payload.transfer_to_seller_cents).toBe(0);
  });

  it('converts a partial refund of dollars to cents', async () => {
    useAdminGoodsDisputes.mockReturnValue({
      data: { disputes: [openDispute] },
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPanel();

    // Radix Select reads pointer-capture APIs jsdom lacks, so drive it with
    // fireEvent.click (matching the existing admin-disputes Select test).
    fireEvent.click(screen.getByRole('combobox', { name: /Select a resolution/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Partial refund' }));
    await user.type(screen.getByLabelText('Refund to buyer ($)'), '40');
    await user.click(screen.getByRole('button', { name: /Resolve dispute/i }));

    await waitFor(() => {
      expect(resolveMutate).toHaveBeenCalledTimes(1);
    });
    const [payload] = resolveMutate.mock.calls[0] as [Record<string, unknown>];
    expect(payload.resolution).toBe('refund_partial');
    expect(payload.refund_to_buyer_cents).toBe(4000);
  });

  it('blocks a partial refund with no amount', async () => {
    useAdminGoodsDisputes.mockReturnValue({
      data: { disputes: [openDispute] },
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPanel();

    fireEvent.click(screen.getByRole('combobox', { name: /Select a resolution/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Partial refund' }));
    await user.click(screen.getByRole('button', { name: /Resolve dispute/i }));

    expect(resolveMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/refund amount greater than \$0/i);
  });

  it('surfaces the 409 already-resolved error via toast', async () => {
    useAdminGoodsDisputes.mockReturnValue({
      data: { disputes: [openDispute] },
      isLoading: false,
      isError: false,
    });
    // Drive the mutation's onError with a real 409 ApiError so the message
    // extraction ("dispute already resolved") is exercised end-to-end.
    resolveMutate.mockImplementation(
      (_vars: unknown, opts: { onError?: (e: unknown) => void }) => {
        opts.onError?.(new ApiError(409, JSON.stringify({ error: 'dispute already resolved' })));
      },
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /Resolve dispute/i }));

    expect(toastError).toHaveBeenCalledWith('dispute already resolved');
  });

  it('hides the resolve form for an already-resolved dispute', () => {
    useAdminGoodsDisputes.mockReturnValue({
      data: { disputes: [{ ...openDispute, status: 'resolved', resolved_at: '2026-06-02T00:00:00Z' }] },
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.queryByRole('button', { name: /Resolve dispute/i })).not.toBeInTheDocument();
    expect(screen.getByText(/already been resolved/i)).toBeInTheDocument();
  });
});
