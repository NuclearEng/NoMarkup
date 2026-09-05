// Tests for the Payments list page — exercises tab content (loading, error,
// empty, data) and pagination handlers.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const paymentsState: {
  data: { payments: { id: string }[]; pagination?: { totalPages: number; hasNext: boolean } } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/payments',
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

vi.mock('@/components/payments/PaymentHistory', () => ({
  PaymentHistory: ({ payments }: { payments: { id: string }[] }) =>
    createElement('div', { 'data-testid': 'payment-history' }, String(payments.length)),
}));

vi.mock('@/hooks/usePayments', () => ({
  usePayments: () => paymentsState,
}));

import PaymentsPage from '@/app/(dashboard)/payments/page';

beforeEach(() => {
  paymentsState.data = undefined;
  paymentsState.isLoading = false;
  paymentsState.isError = false;
  paymentsState.refetch = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PaymentsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(PaymentsPage)));
    expect(container).toBeTruthy();
  });

  it('renders the loading state without throwing', () => {
    paymentsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(PaymentsPage)));
    expect(container).toBeTruthy();
  });

  it('renders the error state with Retry button', () => {
    paymentsState.isError = true;
    render(withQueryClient(createElement(PaymentsPage)));
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });

  it('clicking Retry on error invokes refetch', () => {
    const refetch = vi.fn();
    paymentsState.isError = true;
    paymentsState.refetch = refetch;
    render(withQueryClient(createElement(PaymentsPage)));
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLButtonElement);
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty state with All-tab message', () => {
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(PaymentsPage)));
    expect(screen.getAllByText(/You have no payments yet/i).length).toBeGreaterThan(0);
  });

  it('renders the payment-history component when data is present', () => {
    paymentsState.data = { payments: [{ id: 'pay-1' }] };
    render(withQueryClient(createElement(PaymentsPage)));
    expect(screen.getAllByTestId('payment-history').length).toBeGreaterThan(0);
  });

  it('renders 6 tabs: All / Pending / Escrow / Completed / Failed / Refunded', () => {
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(PaymentsPage)));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(6);
  });

  it('renders Previous/Next pagination when totalPages > 1', () => {
    paymentsState.data = {
      payments: [{ id: 'p1' }],
      pagination: { totalPages: 5, hasNext: true },
    };
    render(withQueryClient(createElement(PaymentsPage)));
    const prev = screen.getAllByRole('button', { name: 'Previous' })[0] as HTMLButtonElement;
    const next = screen.getAllByRole('button', { name: 'Next' })[0] as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(next);
    expect(screen.getAllByText(/Page/i).length).toBeGreaterThan(0);
  });

  it('clicking Previous after Next decrements the page back to 1', () => {
    paymentsState.data = {
      payments: [{ id: 'p1' }],
      pagination: { totalPages: 5, hasNext: true },
    };
    render(withQueryClient(createElement(PaymentsPage)));
    const next = screen.getAllByRole('button', { name: 'Next' })[0] as HTMLButtonElement;
    fireEvent.click(next);
    // After advancing to page 2, Previous becomes enabled.
    const prev = screen.getAllByRole('button', { name: 'Previous' })[0] as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    fireEvent.click(prev);
    // Page label should still render (now shows page 1)
    expect(screen.getAllByText(/Page 1 of/).length).toBeGreaterThan(0);
  });

  it('clicking each tab exercises the tabToStatusFilter switch cases', async () => {
    const user = userEvent.setup();
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(PaymentsPage)));
    const tabNames = ['Pending', 'Escrow', 'Completed', 'Failed', 'Refunded', 'All'];
    for (const name of tabNames) {
      const tab = screen.getByRole('tab', { name });
      await user.click(tab);
      expect(tab.getAttribute('data-state')).toBe('active');
    }
  });

  it('shows the Pending-tab empty message when its tab is active and data is empty', async () => {
    const user = userEvent.setup();
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(PaymentsPage)));
    await user.click(screen.getByRole('tab', { name: 'Pending' }));
    expect(screen.getAllByText(/No pending payments/i).length).toBeGreaterThan(0);
  });

  it('shows the Escrow-tab empty message when its tab is active and data is empty', async () => {
    const user = userEvent.setup();
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(PaymentsPage)));
    await user.click(screen.getByRole('tab', { name: 'Escrow' }));
    expect(screen.getAllByText(/No payments currently in escrow/i).length).toBeGreaterThan(0);
  });

  it('shows the Completed-tab empty message when its tab is active and data is empty', async () => {
    const user = userEvent.setup();
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(PaymentsPage)));
    await user.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(screen.getAllByText(/No completed payments/i).length).toBeGreaterThan(0);
  });

  it('shows the Failed-tab empty message when its tab is active and data is empty', async () => {
    const user = userEvent.setup();
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(PaymentsPage)));
    await user.click(screen.getByRole('tab', { name: 'Failed' }));
    expect(screen.getAllByText(/No failed payments/i).length).toBeGreaterThan(0);
  });

  it('shows the Refunded-tab empty message when its tab is active and data is empty', async () => {
    const user = userEvent.setup();
    paymentsState.data = { payments: [] };
    render(withQueryClient(createElement(PaymentsPage)));
    await user.click(screen.getByRole('tab', { name: 'Refunded' }));
    expect(screen.getAllByText(/No refunded payments/i).length).toBeGreaterThan(0);
  });
});
