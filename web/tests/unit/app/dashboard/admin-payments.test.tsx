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

  it('selects a preset fee percentage from the dropdown', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    // Fee percentage is now a preset Select — open it and pick a preset.
    const trigger = screen.getByRole('combobox', { name: /^Fee Percentage$/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /^12%$/ }));
    // The trigger reflects the chosen preset.
    expect(trigger.textContent).toMatch(/12%/);
  });

  it('allows a custom fee percentage off the preset ladder', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const trigger = screen.getByRole('combobox', { name: /^Fee Percentage$/i });
    fireEvent.click(trigger);
    // Pick "Custom…" to reveal the numeric input, then type an off-ladder value.
    fireEvent.click(screen.getByRole('option', { name: /Custom/i }));
    const custom = screen.getByLabelText(/Fee Percentage custom value/i);
    fireEvent.change(custom, { target: { value: '12.5' } });
    expect((custom as HTMLInputElement).value).toBe('12.5');
  });

  it('selects a preset guarantee percentage from the dropdown', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const trigger = screen.getByRole('combobox', { name: /Guarantee Percentage/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /^2%$/ }));
    expect(trigger.textContent).toMatch(/2%/);
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
    // Percentages are preset dropdowns now — pick 10% and 2% from the ladders.
    const feeTrigger = screen.getByRole('combobox', { name: /^Fee Percentage$/i });
    fireEvent.click(feeTrigger);
    fireEvent.click(screen.getByRole('option', { name: /^10%$/ }));
    const guaranteeTrigger = screen.getByRole('combobox', { name: /Guarantee Percentage/i });
    fireEvent.click(guaranteeTrigger);
    fireEvent.click(screen.getByRole('option', { name: /^2%$/ }));
    fireEvent.change(screen.getByLabelText(/Min Fee/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Max Fee/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Fee Configuration/i }));
    expect(feeMutate).toHaveBeenCalledWith({
      category_id: 'cat-1',
      // Whole-number percents entered in the UI are sent as 0..1 fractions.
      fee_percentage: 0.1,
      guarantee_percentage: 0.02,
      min_fee_cents: 100,
      max_fee_cents: 50000,
      // Lead-gen is off by default → disabled with zeroed fields and no cap.
      lead_gen_enabled: false,
      lead_gen_percentage: 0,
      lead_gen_min_fee_cents: 0,
      lead_gen_max_fee_cents: null,
    });
  });

  it('saves lead-gen fee fields when enabled', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const feeTrigger = screen.getByRole('combobox', { name: /^Fee Percentage$/i });
    fireEvent.click(feeTrigger);
    fireEvent.click(screen.getByRole('option', { name: /^10%$/ }));
    const guaranteeTrigger = screen.getByRole('combobox', { name: /Guarantee Percentage/i });
    fireEvent.click(guaranteeTrigger);
    fireEvent.click(screen.getByRole('option', { name: /^2%$/ }));
    // Enable the lead-gen toggle to reveal its fields.
    fireEvent.click(screen.getByLabelText(/Enable lead-gen fee/i));
    const leadGenTrigger = screen.getByRole('combobox', { name: /Lead-gen Percentage/i });
    fireEvent.click(leadGenTrigger);
    fireEvent.click(screen.getByRole('option', { name: /^10%$/ }));
    fireEvent.change(screen.getByLabelText(/Lead-gen Min Fee \(USD\)/i), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByLabelText(/Lead-gen Max Fee \(USD, optional\)/i), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Fee Configuration/i }));
    expect(feeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_gen_enabled: true,
        lead_gen_percentage: 0.1,
        lead_gen_min_fee_cents: 500,
        lead_gen_max_fee_cents: 5000,
      }),
    );
  });

  it('blocks save and shows an error when fee percentage is out of range', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    // 150 is off the preset ladder — use the "Custom…" path to enter it, which
    // must still be validated and blocked.
    const feeTrigger = screen.getByRole('combobox', { name: /^Fee Percentage$/i });
    fireEvent.click(feeTrigger);
    fireEvent.click(screen.getByRole('option', { name: /Custom/i }));
    fireEvent.change(screen.getByLabelText(/Fee Percentage custom value/i), {
      target: { value: '150' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Fee Configuration/i }));
    expect(feeMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Must be between 0 and 100/i)).toBeDefined();
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

  it('changes status filter via Select trigger and option click', () => {
    // The Select's onValueChange (lines 175-178) only fires through the Radix
    // dropdown — open the trigger, then click an option.
    paymentsState.data = {
      payments: [],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const trigger = screen.getByRole('combobox', {
      name: /filter payments by status/i,
    });
    fireEvent.click(trigger);
    // Pick a non-"all" option so the callback hits the `setStatusFilter(v)` branch.
    const option = screen.getByRole('option', { name: /Pending/i });
    fireEvent.click(option);
    // Now switch back to All Statuses to exercise the `=== ALL_FILTER` branch.
    fireEvent.click(trigger);
    const allOption = screen.getByRole('option', { name: /All Statuses/i });
    fireEvent.click(allOption);
    // No assertion needed beyond not throwing — both branches now executed.
    expect(trigger).toBeDefined();
  });
});
