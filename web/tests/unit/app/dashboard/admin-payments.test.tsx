// Tests for the admin payments page — exercises filter, fee form inputs,
// save action, success/error states, and table column renderers via data fixtures.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const paymentsState: {
  data: { payments: Record<string, unknown>[]; pagination?: Record<string, unknown> } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const revenueState: { data: Record<string, number> | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

const feeMutate = vi.fn(() => Promise.resolve({}));
const feeState = { isPending: false, isError: false, isSuccess: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/payments',
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

vi.mock('@/hooks/useAdmin', () => ({
  useAdminPayments: () => paymentsState,
  useRevenueReport: () => revenueState,
  useUpdateFeeConfig: () => ({
    mutateAsync: feeMutate,
    isPending: feeState.isPending,
    isError: feeState.isError,
    isSuccess: feeState.isSuccess,
  }),
}));

const { default: AdminPaymentsPage } = await import('@/app/(dashboard)/admin/payments/page');

function makePayment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pay-abcdef1234567890',
    amount_cents: 12500,
    platform_fee_cents: 250,
    status: 'completed',
    created_at: '2026-04-15T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  paymentsState.data = undefined;
  paymentsState.isLoading = false;
  paymentsState.isError = false;
  revenueState.data = undefined;
  revenueState.isLoading = false;
  feeState.isPending = false;
  feeState.isError = false;
  feeState.isSuccess = false;
  feeMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminPaymentsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(container).toBeTruthy();
  });

  it('renders revenue metrics when data available', () => {
    revenueState.data = {
      total_gmv_cents: 1000000,
      total_revenue_cents: 100000,
      total_guarantee_fund_cents: 20000,
      effective_take_rate: 0.1,
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(screen.getByText(/Total GMV/i)).toBeDefined();
    expect(screen.getByText(/Platform Revenue/i)).toBeDefined();
    expect(screen.getByText(/10\.00%/)).toBeDefined();
  });

  it('shows error state when payments fetch fails', () => {
    paymentsState.isError = true;
    render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(screen.getByText(/Failed to load payments/i)).toBeDefined();
  });

  it('renders payments table rows when data loaded', () => {
    paymentsState.data = {
      payments: [makePayment(), makePayment({ id: 'pay-zzzzzzzz', status: 'pending' })],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(screen.getByText(/pay-abcdef12/)).toBeDefined();
    expect(screen.getByText(/pay-zzzzzzzz/)).toBeDefined();
  });

  it('updates fee category input', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const input = screen.getByLabelText(/Category ID/i);
    fireEvent.change(input, { target: { value: 'cat-123' } });
    expect((input as HTMLInputElement).value).toBe('cat-123');
  });

  it('updates fee percentage input', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const input = screen.getByLabelText(/^Fee Percentage$/i);
    fireEvent.change(input, { target: { value: '12.5' } });
    expect((input as HTMLInputElement).value).toBe('12.5');
  });

  it('updates guarantee percentage input', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const input = screen.getByLabelText(/Guarantee Percentage/i);
    fireEvent.change(input, { target: { value: '2.0' } });
    expect((input as HTMLInputElement).value).toBe('2.0');
  });

  it('updates min and max fee inputs', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const min = screen.getByLabelText(/Min Fee/i);
    const max = screen.getByLabelText(/Max Fee/i);
    fireEvent.change(min, { target: { value: '1.50' } });
    fireEvent.change(max, { target: { value: '500' } });
    expect((min as HTMLInputElement).value).toBe('1.50');
    expect((max as HTMLInputElement).value).toBe('500');
  });

  it('calls fee mutation with parsed payload on save click', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    fireEvent.change(screen.getByLabelText(/Category ID/i), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText(/^Fee Percentage$/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Guarantee Percentage/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Min Fee/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Max Fee/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Fee Configuration/i }));
    expect(feeMutate).toHaveBeenCalledWith({
      category_id: 'cat-1',
      fee_percentage: 10,
      guarantee_percentage: 2,
      min_fee_cents: 100,
      max_fee_cents: 50000,
    });
  });

  it('shows pending label and disables save when mutation pending', () => {
    feeState.isPending = true;
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const btn = screen.getByRole('button', { name: /Saving/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows error message when fee mutation errors', () => {
    feeState.isError = true;
    render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(screen.getByText(/Failed to update fee configuration/i)).toBeDefined();
  });

  it('shows success message when fee mutation succeeds', () => {
    feeState.isSuccess = true;
    render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(screen.getByText(/Fee configuration updated successfully/i)).toBeDefined();
  });
});
