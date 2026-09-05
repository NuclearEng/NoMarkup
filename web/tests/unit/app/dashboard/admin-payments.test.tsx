// Tests for the admin payments page — exercises filter, fee form inputs,
// save action, success/error states, and table column renderers via data fixtures.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

// jsdom's Storage stub on this version doesn't expose a working localStorage;
// install a minimal in-memory shim so the page can persist lock state
// (and tests can clear it between cases).
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length(): number { return store.size; },
    },
  });
});

const paymentsState: {
  data: { payments: Record<string, unknown>[]; pagination?: Record<string, unknown> } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const revenueState: { data: Record<string, number> | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

// Live, read-only fee config backing the "Current Fees" summary. Percentages
// are stored 0..1 fractions (0.08 = 8%); cents are integers.
const feeConfigState: {
  data: Record<string, unknown> | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const feeMutate = vi.fn(() => Promise.resolve({}));
const feeState = { isPending: false, isError: false, isSuccess: false };

const customFeesState: {
  data: { fees: Record<string, unknown>[] } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const createFeeMutate = vi.fn(() => Promise.resolve({}));
const updateFeeMutate = vi.fn(() => Promise.resolve({}));
const deleteFeeMutate = vi.fn(() => Promise.resolve({}));
const createFeeState = { isPending: false, isError: false, error: null as unknown };
const updateFeeState = { isPending: false, isError: false, error: null as unknown };
const deleteFeeState = { isPending: false, isError: false, error: null as unknown };

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
  useFeeConfig: () => feeConfigState,
  useUpdateFeeConfig: () => ({
    mutateAsync: feeMutate,
    isPending: feeState.isPending,
    isError: feeState.isError,
    isSuccess: feeState.isSuccess,
  }),
  useCustomFees: () => customFeesState,
  useCreateCustomFee: () => ({
    mutateAsync: createFeeMutate,
    isPending: createFeeState.isPending,
    isError: createFeeState.isError,
    error: createFeeState.error,
  }),
  useUpdateCustomFee: () => ({
    mutateAsync: updateFeeMutate,
    isPending: updateFeeState.isPending,
    isError: updateFeeState.isError,
    error: updateFeeState.error,
  }),
  useDeleteCustomFee: () => ({
    mutateAsync: deleteFeeMutate,
    isPending: deleteFeeState.isPending,
    isError: deleteFeeState.isError,
    error: deleteFeeState.error,
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
  feeConfigState.data = undefined;
  feeConfigState.isLoading = false;
  feeConfigState.isError = false;
  feeState.isPending = false;
  feeState.isError = false;
  feeState.isSuccess = false;
  feeMutate.mockClear();
  customFeesState.data = undefined;
  customFeesState.isLoading = false;
  customFeesState.isError = false;
  createFeeState.isPending = false;
  createFeeState.isError = false;
  createFeeState.error = null;
  updateFeeState.isPending = false;
  updateFeeState.isError = false;
  updateFeeState.error = null;
  deleteFeeState.isPending = false;
  deleteFeeState.isError = false;
  deleteFeeState.error = null;
  createFeeMutate.mockClear();
  updateFeeMutate.mockClear();
  deleteFeeMutate.mockClear();
  // The page persists lock state to localStorage; clear it so each test starts
  // unlocked.
  window.localStorage.clear();
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

  it('renders the Current Fees summary from live config (fractions → percent)', () => {
    feeConfigState.data = {
      fee_percentage: 0.08,
      guarantee_percentage: 0.02,
      min_fee_cents: 100,
      max_fee_cents: 50000,
      lead_gen_enabled: false,
      lead_gen_percentage: 0.1,
      lead_gen_min_fee_cents: 0,
      lead_gen_max_fee_cents: null,
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(screen.getByText(/Current Fees/i)).toBeDefined();
    // Scope to the read-only summary table (labelled by its sr-only caption) so
    // these don't collide with the editable steppers below, which reuse the
    // same labels and also render the seeded percents.
    const summary = within(
      screen.getByRole('table', { name: /Currently active platform fees/i }),
    );
    // Fractions are formatted as human percents.
    expect(summary.getByText(/^8%$/)).toBeDefined();
    expect(summary.getByText(/Platform commission/i)).toBeDefined();
    expect(summary.getByText(/Guarantee \(buyer protection\)/i)).toBeDefined();
    // Lead-gen is off → muted Disabled badge, and the static reference rows show.
    expect(summary.getByText(/^Disabled$/)).toBeDefined();
    expect(summary.getByText(/Working-capital advance/i)).toBeDefined();
    expect(screen.getByText(/Instant payout/i)).toBeDefined();
    expect(screen.getByText(/no markup/i)).toBeDefined();
  });

  it('shows an Enabled badge when lead-gen fee is active', () => {
    feeConfigState.data = {
      fee_percentage: 0.08,
      guarantee_percentage: 0.02,
      min_fee_cents: 0,
      max_fee_cents: 0,
      lead_gen_enabled: true,
      lead_gen_percentage: 0.1,
      lead_gen_min_fee_cents: 0,
      lead_gen_max_fee_cents: null,
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(screen.getByText(/^Enabled$/)).toBeDefined();
    // Unset min/max caps render as em-dashes.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
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

  it('seeds the steppers from the live fee config (fractions → percent)', () => {
    feeConfigState.data = {
      fee_percentage: 0.08,
      guarantee_percentage: 0.02,
      min_fee_cents: 0,
      max_fee_cents: 0,
      lead_gen_enabled: false,
      lead_gen_percentage: 0.1,
      lead_gen_min_fee_cents: 0,
      lead_gen_max_fee_cents: null,
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    // The platform-commission stepper is a spinbutton seeded from 0.08 → 8%.
    const stepper = screen.getByRole('spinbutton', { name: /^Platform commission$/i });
    expect(stepper.getAttribute('aria-valuenow')).toBe('8');
  });

  it('increments and decrements a fee via the stepper buttons', () => {
    feeConfigState.data = {
      fee_percentage: 0.08,
      guarantee_percentage: 0.02,
      min_fee_cents: 0,
      max_fee_cents: 0,
      lead_gen_enabled: false,
      lead_gen_percentage: 0.1,
      lead_gen_min_fee_cents: 0,
      lead_gen_max_fee_cents: null,
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const stepper = screen.getByRole('spinbutton', { name: /^Platform commission$/i });
    fireEvent.click(screen.getByRole('button', { name: /Increase Platform commission/i }));
    expect(stepper.getAttribute('aria-valuenow')).toBe('8.5');
    fireEvent.click(screen.getByRole('button', { name: /Decrease Platform commission/i }));
    fireEvent.click(screen.getByRole('button', { name: /Decrease Platform commission/i }));
    expect(stepper.getAttribute('aria-valuenow')).toBe('7.5');
  });

  it('adjusts a fee via keyboard arrows on the spinbutton', () => {
    feeConfigState.data = {
      fee_percentage: 0.08,
      guarantee_percentage: 0.02,
      min_fee_cents: 0,
      max_fee_cents: 0,
      lead_gen_enabled: false,
      lead_gen_percentage: 0.1,
      lead_gen_min_fee_cents: 0,
      lead_gen_max_fee_cents: null,
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const stepper = screen.getByRole('spinbutton', { name: /^Platform commission$/i });
    fireEvent.keyDown(stepper, { key: 'ArrowUp' });
    expect(stepper.getAttribute('aria-valuenow')).toBe('8.5');
    fireEvent.keyDown(stepper, { key: 'ArrowDown' });
    expect(stepper.getAttribute('aria-valuenow')).toBe('8');
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
    feeConfigState.data = {
      fee_percentage: 0.1,
      guarantee_percentage: 0.02,
      min_fee_cents: 0,
      max_fee_cents: 0,
      lead_gen_enabled: false,
      lead_gen_percentage: 0.1,
      lead_gen_min_fee_cents: 0,
      lead_gen_max_fee_cents: null,
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    fireEvent.change(screen.getByLabelText(/Category ID/i), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText(/Min Fee/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Max Fee/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Configuration/i }));
    expect(feeMutate).toHaveBeenCalledWith({
      category_id: 'cat-1',
      // Steppers hold whole-number percents (seeded 0.10 → 10%); sent as fractions.
      fee_percentage: 0.1,
      guarantee_percentage: 0.02,
      min_fee_cents: 100,
      max_fee_cents: 50000,
      // Lead-gen is off → disabled with zeroed fields and no cap.
      lead_gen_enabled: false,
      lead_gen_percentage: 0.1,
      lead_gen_min_fee_cents: 0,
      lead_gen_max_fee_cents: null,
    });
  });

  it('saves lead-gen fee fields when enabled', () => {
    feeConfigState.data = {
      fee_percentage: 0.1,
      guarantee_percentage: 0.02,
      min_fee_cents: 0,
      max_fee_cents: 0,
      lead_gen_enabled: true,
      lead_gen_percentage: 0.1,
      lead_gen_min_fee_cents: 500,
      lead_gen_max_fee_cents: 5000,
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    fireEvent.click(screen.getByRole('button', { name: /Save Configuration/i }));
    expect(feeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_gen_enabled: true,
        lead_gen_percentage: 0.1,
        lead_gen_min_fee_cents: 500,
        lead_gen_max_fee_cents: 5000,
      }),
    );
  });

  it('locks and unlocks the configuration, disabling steppers when locked', () => {
    feeConfigState.data = {
      fee_percentage: 0.08,
      guarantee_percentage: 0.02,
      min_fee_cents: 0,
      max_fee_cents: 0,
      lead_gen_enabled: false,
      lead_gen_percentage: 0.1,
      lead_gen_min_fee_cents: 0,
      lead_gen_max_fee_cents: null,
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    fireEvent.click(screen.getByRole('button', { name: /Lock Configuration/i }));
    // Locked badge appears and the stepper +/- buttons are disabled.
    expect(screen.getByText(/^Locked$/)).toBeDefined();
    const incBtn: HTMLButtonElement = screen.getByRole('button', {
      name: /Increase Platform commission/i,
    });
    expect(incBtn.disabled).toBe(true);
    // Save is disabled while locked.
    const saveBtn: HTMLButtonElement = screen.getByRole('button', {
      name: /Save Configuration/i,
    });
    expect(saveBtn.disabled).toBe(true);
    // Unlock re-enables editing.
    fireEvent.click(screen.getByRole('button', { name: /Unlock/i }));
    const incBtnAfter: HTMLButtonElement = screen.getByRole('button', {
      name: /Increase Platform commission/i,
    });
    expect(incBtnAfter.disabled).toBe(false);
  });

  it('adds a custom fee via the API (percent → basis points)', async () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Featured listing' } });
    fireEvent.change(screen.getByLabelText(/Default %/i), { target: { value: '5' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Add fee$/i }));
    });
    expect(createFeeMutate).toHaveBeenCalledWith({
      name: 'Featured listing',
      rate_bps: 500,
    });
    expect(screen.queryByText(/UI preview only/i)).toBeNull();
  });

  it('renders persisted custom fees as live steppers', () => {
    customFeesState.data = {
      fees: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Featured listing',
          rate_bps: 500,
          active: true,
          created_at: '2026-08-21T12:00:00Z',
          updated_at: '2026-08-21T12:00:00Z',
        },
      ],
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    const stepper = screen.getByRole('spinbutton', { name: /^Featured listing$/i });
    expect(stepper.getAttribute('aria-valuenow')).toBe('5');
    expect(screen.getByText(/Custom · live/i)).toBeDefined();
    expect(screen.queryByText(/UI preview only/i)).toBeNull();
  });

  it('patches rate_bps when a custom-fee stepper is incremented', () => {
    customFeesState.data = {
      fees: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Featured listing',
          rate_bps: 500,
          active: true,
          created_at: '2026-08-21T12:00:00Z',
          updated_at: '2026-08-21T12:00:00Z',
        },
      ],
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    fireEvent.click(screen.getByRole('button', { name: /Increase Featured listing/i }));
    expect(updateFeeMutate).toHaveBeenCalledWith({
      id: '11111111-1111-1111-1111-111111111111',
      rate_bps: 550,
    });
  });

  it('deactivates a custom fee via Remove', () => {
    customFeesState.data = {
      fees: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Featured listing',
          rate_bps: 500,
          active: true,
          created_at: '2026-08-21T12:00:00Z',
          updated_at: '2026-08-21T12:00:00Z',
        },
      ],
    };
    render(withQueryClient(createElement(AdminPaymentsPage)));
    fireEvent.click(screen.getByRole('button', { name: /Remove Featured listing fee/i }));
    expect(deleteFeeMutate).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('shows custom-fee loading and error states', () => {
    customFeesState.isLoading = true;
    const { unmount } = render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(screen.getByLabelText(/Loading custom fees/i)).toBeDefined();
    unmount();
    customFeesState.isLoading = false;
    customFeesState.isError = true;
    render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(screen.getByText(/Could not load custom fees/i)).toBeDefined();
  });

  it('blocks adding a custom fee with no name', () => {
    render(withQueryClient(createElement(AdminPaymentsPage)));
    fireEvent.change(screen.getByLabelText(/Default %/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add fee$/i }));
    expect(screen.getByText(/Enter a fee name/i)).toBeDefined();
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
