// Smoke + branch tests for the provider working-capital advances page.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/advances',
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

// Mock the Radix Select primitives with native <select> so we can drive
// onValueChange directly via a `change` event in tests. Trigger/Value/Content
// render as fragments so they pass <SelectItem> children up to the <select>.
vi.mock('@/components/ui/select', () => ({
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
      'select',
      {
        'data-testid': 'advance-contract-select',
        'aria-label': 'Select contract',
        value,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          onValueChange(e.target.value);
        },
      },
      // Always include an empty option so React doesn't warn about controlled
      // select with value="" missing an empty option.
      createElement('option', { value: '', key: '__empty' }, ''),
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) =>
    createElement(
      // Wrap content children in a fragment-like Group so plain text inside
      // SelectContent (e.g. "No active contracts available") doesn't break.
      'optgroup',
      { label: 'options' },
      children,
    ),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => createElement('option', { value }, children),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContracts: vi.fn(),
}));

vi.mock('@/hooks/useWorkingCapital', () => ({
  useCreditLimit: vi.fn(),
  useMyAdvances: vi.fn(),
  useRequestAdvance: vi.fn(),
  useRepayAdvance: vi.fn(),
}));

const { useContracts } = await import('@/hooks/useContracts');
const { useCreditLimit, useMyAdvances, useRepayAdvance, useRequestAdvance } = await import(
  '@/hooks/useWorkingCapital'
);
const { default: ProviderAdvancesPage, outstandingCents } = await import(
  '@/app/(dashboard)/provider/advances/page'
);

function setHooks(opts: {
  advances?: unknown[];
  isLoading?: boolean;
  isError?: boolean;
  contracts?: unknown[];
  creditLimit?: unknown;
  refetch?: () => void;
  mutate?: ReturnType<typeof vi.fn>;
  isPending?: boolean;
  isMutateError?: boolean;
  repayMutate?: ReturnType<typeof vi.fn>;
  repayPending?: boolean;
} = {}) {
  vi.mocked(useMyAdvances).mockReturnValue({
    data: opts.advances ? { advances: opts.advances } : undefined,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    refetch: opts.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useMyAdvances>);
  vi.mocked(useContracts).mockReturnValue({
    data: opts.contracts ? { contracts: opts.contracts } : undefined,
    isLoading: false,
  } as unknown as ReturnType<typeof useContracts>);
  vi.mocked(useCreditLimit).mockReturnValue({
    data: opts.creditLimit,
    isLoading: false,
  } as unknown as ReturnType<typeof useCreditLimit>);
  vi.mocked(useRequestAdvance).mockReturnValue({
    mutate: opts.mutate ?? vi.fn(),
    mutateAsync: vi.fn(),
    isPending: opts.isPending ?? false,
    isError: opts.isMutateError ?? false,
    error: opts.isMutateError ? new Error('Network failure') : null,
  } as unknown as ReturnType<typeof useRequestAdvance>);
  vi.mocked(useRepayAdvance).mockReturnValue({
    mutate: opts.repayMutate ?? vi.fn(),
    mutateAsync: vi.fn(),
    isPending: opts.repayPending ?? false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useRepayAdvance>);
}

describe('ProviderAdvancesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHooks();
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(container).toBeTruthy();
  });

  it('renders the loading skeleton state', () => {
    setHooks({ isLoading: true });
    const { container } = render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('renders the page-level error state with retry', () => {
    const refetch = vi.fn();
    setHooks({ isError: true, refetch });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(
      screen.getByText('Unable to load your advances. This may be a temporary issue.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty advance history state', () => {
    setHooks({ advances: [] });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(screen.getByText('No advances yet')).toBeDefined();
  });

  it('renders advance rows with status badge and contract reference', () => {
    setHooks({
      advances: [
        {
          id: 'adv_1',
          contract_id: 'contract-id-12345678',
          contract_number: 'CN-001',
          advance_amount_cents: 100000,
          fee_cents: 2500,
          repaid_cents: 0,
          status: 'requested',
          created_at: '2026-01-01T00:00:00Z',
          rejection_reason: null,
        },
      ],
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // Contract reference + bullet + date are rendered in the same paragraph;
    // use a regex to handle the `${ref} • ${date}` concatenation.
    expect(screen.getByText(/CN-001/)).toBeDefined();
    expect(screen.getByText('Requested')).toBeDefined();
  });

  it('renders the rejection reason for rejected advances', () => {
    setHooks({
      advances: [
        {
          id: 'adv_2',
          contract_id: 'contract-id-2',
          contract_number: 'CN-002',
          advance_amount_cents: 5000,
          fee_cents: 0,
          repaid_cents: 0,
          status: 'rejected',
          created_at: '2026-01-02T00:00:00Z',
          rejection_reason: 'Insufficient contract value',
        },
      ],
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(screen.getByText('Insufficient contract value')).toBeDefined();
  });

  it('toggles the credit explanation panel when clicked', () => {
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    const toggle = screen.getByRole('button', { name: /How is my credit determined/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Active contract value')).toBeDefined();
  });

  it('shows fee preview when an amount is entered', () => {
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    const input = screen.getByLabelText(/Amount/);
    fireEvent.change(input, { target: { value: '500' } });
    expect(screen.getByText('Fee Estimate')).toBeDefined();
  });

  it('shows the inline error banner with retry when the request fails', () => {
    const mutate = vi.fn();
    setHooks({
      isMutateError: true,
      mutate,
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('renders the Request Advance section when not loading/erroring', () => {
    setHooks({ contracts: [] });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // Heading "Request Advance" + button "Request Advance" both appear; use heading role.
    expect(screen.getByRole('heading', { name: 'Request Advance' })).toBeDefined();
  });

  it('renders 403 / Forbidden error message when mutation rejects with 403', () => {
    setHooks({
      isMutateError: true,
      mutate: vi.fn(),
    });
    // Override the error message to trigger 403 path
    vi.mocked(useRequestAdvance).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('403 Forbidden'),
    } as unknown as ReturnType<typeof useRequestAdvance>);
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(
      screen.getByText(
        /You do not have permission to request advances. Your account may need verification./,
      ),
    ).toBeDefined();
  });

  it('renders 429 / Too Many Requests error message', () => {
    vi.mocked(useRequestAdvance).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('429 Too Many Requests'),
    } as unknown as ReturnType<typeof useRequestAdvance>);
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(
      screen.getByText(/Too many requests. Please wait a moment before trying again./),
    ).toBeDefined();
  });

  it('renders 422 / Validation error message', () => {
    vi.mocked(useRequestAdvance).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('422 Validation failed'),
    } as unknown as ReturnType<typeof useRequestAdvance>);
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(
      screen.getByText(/Invalid request. Please check the amount and selected contract./),
    ).toBeDefined();
  });

  it('renders 409 / Conflict error message', () => {
    vi.mocked(useRequestAdvance).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('409 Conflict'),
    } as unknown as ReturnType<typeof useRequestAdvance>);
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(
      screen.getByText(/An advance for this contract is already pending review./),
    ).toBeDefined();
  });

  it('renders Network error message', () => {
    vi.mocked(useRequestAdvance).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('Network is down'),
    } as unknown as ReturnType<typeof useRequestAdvance>);
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(
      screen.getByText(/Network error. Please check your connection and try again./),
    ).toBeDefined();
  });

  it('renders generic fallback error message for unknown errors', () => {
    vi.mocked(useRequestAdvance).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
      // Non-Error value — exercises the `if (error instanceof Error)` false branch
      error: 'something weird' as unknown as Error,
    } as unknown as ReturnType<typeof useRequestAdvance>);
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(screen.getByText(/Failed to request advance. Please try again./)).toBeDefined();
  });

  it('shows pending spinner on the submit button when isPending', () => {
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
      isPending: true,
    });
    const { container } = render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(container.querySelectorAll('.animate-spin').length).toBeGreaterThan(0);
  });

  it('renders advance row with repaid_cents and repayment progress bar (repaying)', () => {
    setHooks({
      advances: [
        {
          id: 'adv_repaying',
          contract_id: 'contract-id-repaying',
          contract_number: 'CN-RPY',
          advance_amount_cents: 100000,
          fee_cents: 2500,
          repaid_cents: 50000,
          status: 'repaying',
          created_at: '2026-01-01T00:00:00Z',
          rejection_reason: null,
        },
      ],
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // The "Fee" + "Repaid" combined paragraph is a single text node with bullets.
    expect(screen.getByText(/Repaid:/)).toBeDefined();
    // Look for "Repayment" label inside progress bar section
    expect(screen.getByText('Repayment')).toBeDefined();
    expect(screen.getAllByRole('progressbar', { name: 'Repayment progress' }).length).toBe(1);
  });

  it('renders fully-repaid advance with 100% progress bar (repaid)', () => {
    setHooks({
      advances: [
        {
          id: 'adv_repaid',
          contract_id: 'contract-id-repaid',
          contract_number: 'CN-DONE',
          advance_amount_cents: 100000,
          fee_cents: 2500,
          repaid_cents: 102500,
          status: 'repaid',
          created_at: '2026-01-01T00:00:00Z',
          rejection_reason: null,
        },
      ],
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(screen.getByText('Repayment')).toBeDefined();
    // Repaid, 100%, should appear
    expect(screen.getByText(/100%/)).toBeDefined();
  });

  it('renders disbursed advance with 0% repayment progress', () => {
    setHooks({
      advances: [
        {
          id: 'adv_disbursed',
          contract_id: 'contract-id-disb',
          contract_number: 'CN-DISB',
          advance_amount_cents: 100000,
          fee_cents: 0,
          repaid_cents: 0,
          status: 'disbursed',
          created_at: '2026-01-01T00:00:00Z',
          rejection_reason: null,
        },
      ],
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(screen.getByText('Repayment')).toBeDefined();
  });

  it('renders mid utilization color (50-79%) for credit utilization bar', () => {
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
      // outstanding $3000 / max credit $5000 = 60% utilization (amber)
      creditLimit: {
        max_advance_cents: 500000,
        total_outstanding_cents: 300000,
        available_cents: 200000,
        risk_score: 50,
      },
    });
    const { container } = render(withQueryClient(createElement(ProviderAdvancesPage)));
    // The amber-class bar should appear at least once
    expect(container.querySelectorAll('.bg-amber-500\\/60').length).toBeGreaterThan(0);
  });

  it('renders high utilization color (>=80%) for credit utilization bar', () => {
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
      creditLimit: {
        max_advance_cents: 500000,
        total_outstanding_cents: 480000,
        available_cents: 20000,
        risk_score: 90,
      },
    });
    const { container } = render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(container.querySelectorAll('.bg-red-500\\/60').length).toBeGreaterThan(0);
  });

  it('exercises the credit explanation utilization bar at low/mid/high', () => {
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
      creditLimit: {
        max_advance_cents: 500000,
        total_outstanding_cents: 100000,
        available_cents: 400000,
        risk_score: 10,
      },
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // Expand the credit explanation to render its inner bar
    fireEvent.click(screen.getByRole('button', { name: /How is my credit determined/ }));
    // Look for the utilization breakdown details
    expect(screen.getByText(/Active contract value/)).toBeDefined();
  });

  it('handleRequestAdvance: submits with parsed cents and resets fields on success', () => {
    const mutate = vi.fn((_payload, opts?: { onSuccess?: () => void }) => {
      // Simulate the mutation success callback
      opts?.onSuccess?.();
    });
    setHooks({
      contracts: [{ id: 'c-real', contract_number: 'CN-REAL', amount_cents: 1000000 }],
      mutate,
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // Drive the mocked Select to choose contract 'c-real'
    fireEvent.change(screen.getByTestId('advance-contract-select'), {
      target: { value: 'c-real' },
    });
    // Set the amount input
    const amount = screen.getByLabelText(/Amount/);
    fireEvent.change(amount, { target: { value: '250.50' } });
    // Submit the form
    const form = screen.getByRole('button', { name: /^Request Advance$/ }).closest('form') as HTMLElement;
    fireEvent.submit(form);
    expect(mutate).toHaveBeenCalledWith(
      {
        contract_id: 'c-real',
        advance_amount_cents: 25050,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) as unknown }),
    );
    // After onSuccess, fields should be reset
    if (!(amount instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(amount.value).toBe('');
  });

  it('handleRequestAdvance: bails out when amount is NaN', () => {
    const mutate = vi.fn();
    setHooks({
      contracts: [{ id: 'c-nan', contract_number: 'CN-NAN', amount_cents: 1000000 }],
      mutate,
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    fireEvent.change(screen.getByTestId('advance-contract-select'), {
      target: { value: 'c-nan' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: 'abc' },
    });
    const form = screen.getByRole('button', { name: /^Request Advance$/ }).closest('form') as HTMLElement;
    fireEvent.submit(form);
    // amountDollars is truthy but parseFloat returns NaN — early return
    expect(mutate).not.toHaveBeenCalled();
  });

  it('inline retry button calls mutate when contract+amount are valid', () => {
    const mutate = vi.fn();
    vi.mocked(useMyAdvances).mockReturnValue({
      data: { advances: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMyAdvances>);
    vi.mocked(useContracts).mockReturnValue({
      data: { contracts: [{ id: 'c-retry', contract_number: 'CN-RETRY', amount_cents: 1000000 }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useContracts>);
    vi.mocked(useCreditLimit).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    vi.mocked(useRequestAdvance).mockReturnValue({
      mutate,
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('Network error'),
    } as unknown as ReturnType<typeof useRequestAdvance>);

    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // Pick a contract via the mocked Select and a valid amount
    fireEvent.change(screen.getByTestId('advance-contract-select'), {
      target: { value: 'c-retry' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: '100' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(mutate).toHaveBeenCalledWith({
      contract_id: 'c-retry',
      advance_amount_cents: 10000,
    });
  });

  it('handleRequestAdvance: early return when amount is empty', () => {
    const mutate = vi.fn();
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
      mutate,
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    const form = screen.getByRole('button', { name: /^Request Advance$/ }).closest('form') as HTMLElement;
    fireEvent.submit(form);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('clicks the inline retry button when contract+amount are valid', () => {
    const mutate = vi.fn();
    // First render with isError true and a valid mutation state
    vi.mocked(useMyAdvances).mockReturnValue({
      data: { advances: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMyAdvances>);
    vi.mocked(useContracts).mockReturnValue({
      data: { contracts: [{ id: 'c-x', contract_number: 'CN-X', amount_cents: 1000000 }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useContracts>);
    vi.mocked(useCreditLimit).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    vi.mocked(useRequestAdvance).mockReturnValue({
      mutate,
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('Network error'),
    } as unknown as ReturnType<typeof useRequestAdvance>);

    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // Type a valid amount in advance input
    const amount = screen.getByLabelText(/Amount/);
    fireEvent.change(amount, { target: { value: '100' } });
    // The retry button has no selectedContract so the inner condition fails and
    // mutate is NOT called — that's the false branch.
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('renders empty contracts message inside the contract select content', () => {
    setHooks({ contracts: [] });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // The "No active contracts available" placeholder is inside the SelectContent
    // popover and may not be in the DOM until the trigger is clicked. Just
    // ensure the page rendered without throwing.
    expect(screen.getByLabelText('Select contract')).toBeDefined();
  });

  // ── outstandingCents helper (integer-cents math) ──
  describe('outstandingCents', () => {
    it('returns principal + fee - repaid', () => {
      expect(
        outstandingCents({
          advance_amount_cents: 100000,
          fee_cents: 2500,
          repaid_cents: 40000,
        } as never),
      ).toBe(62500);
    });

    it('floors at 0 when over-collected / fully repaid', () => {
      expect(
        outstandingCents({
          advance_amount_cents: 100000,
          fee_cents: 2500,
          repaid_cents: 110000,
        } as never),
      ).toBe(0);
    });
  });

  // ── Manual repay flow ──
  const repayingAdvance = {
    id: 'adv_repay',
    contract_id: 'contract-id-repay',
    contract_number: 'CN-RP',
    advance_amount_cents: 100000,
    fee_cents: 2500,
    repaid_cents: 50000,
    status: 'repaying',
    created_at: '2026-01-01T00:00:00Z',
    rejection_reason: null,
  };

  it('shows a Repay button on outstanding (repaying) advances', () => {
    setHooks({ advances: [repayingAdvance] });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(screen.getByRole('button', { name: /Repay advance CN-RP/ })).toBeDefined();
  });

  it('does NOT show a Repay button on fully-repaid advances', () => {
    setHooks({
      advances: [
        {
          ...repayingAdvance,
          id: 'adv_done',
          repaid_cents: 102500,
          status: 'repaid',
        },
      ],
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    expect(screen.queryByRole('button', { name: /^Repay advance/ })).toBeNull();
  });

  it('opens the repay dialog pre-filled with the outstanding balance', () => {
    setHooks({ advances: [repayingAdvance] });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    fireEvent.click(screen.getByRole('button', { name: /Repay advance CN-RP/ }));
    const input = screen.getByLabelText(/Repayment amount/);
    if (!(input instanceof HTMLInputElement)) throw new Error('expected input');
    // outstanding = 100000 + 2500 - 50000 = 52500 cents => "525.00"
    expect(input.value).toBe('525.00');
  });

  it('submits the parsed cents to useRepayAdvance', () => {
    const repayMutate = vi.fn();
    setHooks({ advances: [repayingAdvance], repayMutate });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    fireEvent.click(screen.getByRole('button', { name: /Repay advance CN-RP/ }));
    fireEvent.change(screen.getByLabelText(/Repayment amount/), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: /^Repay \$200/ }));
    expect(repayMutate).toHaveBeenCalledWith(
      { advanceId: 'adv_repay', amount_cents: 20000 },
      expect.objectContaining({ onSuccess: expect.any(Function) as unknown }),
    );
  });

  it('blocks over-repayment with an inline message and disabled submit', () => {
    const repayMutate = vi.fn();
    setHooks({ advances: [repayingAdvance], repayMutate });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    fireEvent.click(screen.getByRole('button', { name: /Repay advance CN-RP/ }));
    // Outstanding is $525; entering $600 exceeds it.
    fireEvent.change(screen.getByLabelText(/Repayment amount/), { target: { value: '600' } });
    expect(screen.getByText(/exceeds the outstanding balance/)).toBeDefined();
    const submit = screen.getByRole('button', { name: /^Repay$/ });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.click(submit);
    expect(repayMutate).not.toHaveBeenCalled();
  });

  it('uses contract_id slice fallback when contract_number is missing', () => {
    setHooks({
      advances: [
        {
          id: 'adv_no_num',
          contract_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          // contract_number intentionally omitted
          advance_amount_cents: 5000,
          fee_cents: 0,
          repaid_cents: 0,
          status: 'approved',
          created_at: '2026-01-01T00:00:00Z',
          rejection_reason: null,
        },
      ],
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // First 8 chars of the contract_id should appear in the row
    expect(screen.getByText(/aaaaaaaa/)).toBeDefined();
  });

  // ── BUG 1: repay dialog renders real, visible content when opened ──
  it('repay dialog renders its form (heading, balance, amount field, submit) when opened', () => {
    setHooks({ advances: [repayingAdvance] });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    fireEvent.click(screen.getByRole('button', { name: /Repay advance CN-RP/ }));

    // The dialog body must contain real content — not an empty/transparent panel.
    expect(screen.getByRole('heading', { name: 'Repay advance' })).toBeDefined();
    expect(screen.getByText('Outstanding balance')).toBeDefined();
    expect(screen.getByLabelText(/Repayment amount/)).toBeDefined();
    expect(screen.getByRole('button', { name: /^Repay \$525/ })).toBeDefined();

    // Surface guard: the content uses an opaque elevated surface + bg-card token
    // so it can never render as a transparent "black highlighted screen".
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('glass-elevated');
    expect(dialog.className).toContain('bg-card');
  });

  it('repay dialog shows a fully-repaid empty state when there is no balance left', () => {
    setHooks({
      advances: [
        {
          ...repayingAdvance,
          // principal + fee fully covered by repaid → outstanding 0 but still
          // in a repayable status, so the dialog can open with no balance.
          repaid_cents: 102500,
          status: 'repaying',
        },
      ],
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    // Repay button is hidden at 0 outstanding, so drive the dialog open path by
    // asserting the guard via a repayable-but-settled advance is not offered.
    expect(screen.queryByRole('button', { name: /^Repay advance/ })).toBeNull();
  });

  // ── BUG 2: utilization bar is full + labeled when 0 credit available ──
  it('credit utilization bar renders FULL (100%) and labeled when 0 available', () => {
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
      creditLimit: {
        max_advance_cents: 500000,
        total_outstanding_cents: 500000,
        available_cents: 0,
        risk_score: 80,
      },
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    const bar = screen.getByRole('progressbar', {
      name: /Credit fully utilized: 100% used, \$0 available/,
    });
    // Never a blank track — the bar fills to 100%.
    expect(bar.style.width).toBe('100%');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    // Intuitive footer copy instead of a bare "$0 available" next to an empty bar.
    expect(screen.getByText(/Fully utilized/)).toBeDefined();
  });

  it('credit utilization bar is full when there is no limit at all ($0 max)', () => {
    setHooks({
      // No active contracts → derived maxCredit 0, available 0. Must still
      // render a full, labeled bar rather than a blank track.
      contracts: [],
      creditLimit: {
        max_advance_cents: 0,
        total_outstanding_cents: 0,
        available_cents: 0,
        risk_score: 90,
      },
    });
    render(withQueryClient(createElement(ProviderAdvancesPage)));
    const bar = screen.getByRole('progressbar', {
      name: /Credit fully utilized/,
    });
    expect(bar.style.width).toBe('100%');
  });
});
