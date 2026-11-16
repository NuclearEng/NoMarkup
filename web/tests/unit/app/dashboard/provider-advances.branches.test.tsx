// Branch tests for the provider working-capital advances page that the smoke
// file (provider-advances.test.tsx) leaves uncovered: the explainable credit
// decision card (approved / declined), risk-priced fee preview, the legacy
// heuristic fallbacks used when no credit-limit payload arrives, and the repay
// dialog's cancel / pending / settled / success paths.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contract, CreditLimit, WorkingCapitalAdvance } from '@/types';

import { withQueryClient } from './_helpers';

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
        value,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          onValueChange(e.target.value);
        },
      },
      createElement('option', { value: '', key: '__empty' }, ''),
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) =>
    createElement('optgroup', { label: 'options' }, children),
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) =>
    createElement('option', { value }, children),
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

const { TooltipProvider } = await import('@/components/ui/tooltip');
const { useContracts } = await import('@/hooks/useContracts');
const { useCreditLimit, useMyAdvances, useRepayAdvance, useRequestAdvance } = await import(
  '@/hooks/useWorkingCapital'
);
const { default: ProviderAdvancesPage } = await import(
  '@/app/(dashboard)/provider/advances/page'
);

type PricedLimit = CreditLimit & {
  business_credit_score?: number;
  credit_grade?: string;
  apr_bps?: number;
};

interface RepayOptions {
  onSuccess?: () => void;
}
type RepayMutate = (
  vars: { advanceId: string; amount_cents: number },
  opts?: RepayOptions,
) => void;
type RequestMutate = (
  vars: { contract_id: string; advance_amount_cents: number },
  opts?: RepayOptions,
) => void;

interface HookOptions {
  advances?: WorkingCapitalAdvance[];
  contracts?: Pick<Contract, 'id' | 'contract_number' | 'amount_cents'>[];
  creditLimit?: PricedLimit;
  requestMutate?: RequestMutate;
  repayMutate?: RepayMutate;
  repayPending?: boolean;
}

function setHooks(opts: HookOptions = {}): void {
  vi.mocked(useMyAdvances).mockReturnValue({
    data: opts.advances ? { advances: opts.advances } : undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
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
    mutate: opts.requestMutate ?? vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useRequestAdvance>);
  vi.mocked(useRepayAdvance).mockReturnValue({
    mutate: opts.repayMutate ?? vi.fn(),
    isPending: opts.repayPending ?? false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useRepayAdvance>);
}

function page() {
  return withQueryClient(createElement(TooltipProvider, null, createElement(ProviderAdvancesPage)));
}

function renderPage() {
  return render(page());
}

function advance(overrides: Partial<WorkingCapitalAdvance> = {}): WorkingCapitalAdvance {
  return {
    id: 'adv-1',
    provider_id: 'prov-1',
    contract_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    contract_number: 'CN-100',
    advance_amount_cents: 100000,
    fee_cents: 2500,
    repaid_cents: 50000,
    status: 'repaying',
    created_at: '2026-01-15T12:00:00Z',
    ...overrides,
  };
}

function limit(overrides: Partial<PricedLimit> = {}): PricedLimit {
  return {
    max_advance_cents: 1000000,
    total_outstanding_cents: 0,
    available_cents: 400000,
    risk_score: 0.1,
    ...overrides,
  };
}

/** The value node of a summary stat card, located by its title. */
function statValue(title: string): string {
  const card = screen.getByText(title).closest('.glass');
  if (!(card instanceof HTMLElement)) throw new Error(`stat card "${title}" not found`);
  return card.querySelector('.gold-text')?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  setHooks();
});

describe('ProviderAdvancesPage — approved credit decision', () => {
  it('shows the elite line with factor-rate pricing, holdback, outstanding and model version', () => {
    setHooks({
      creditLimit: limit({
        approved: true,
        tier: 'elite',
        available_advance_cents: 750000,
        available_cents: 1,
        total_outstanding_cents: 250000,
        factor_rate: 1.085,
        fee_bps: 1200,
        holdback_pct: 12,
        binding_cap: 'absolute_max',
        model_version: 'uw-2026.06.1',
      }),
    });
    renderPage();

    const card = screen.getByRole('region', { name: 'Your working capital line' });
    const inCard = within(card);
    expect(inCard.getByText('Elite tier')).toBeInTheDocument();
    // Prefers the decision engine's available_advance_cents over legacy available_cents.
    expect(inCard.getByText('$7,500.00')).toBeInTheDocument();
    expect(inCard.getByText('$10,000.00 total line • $2,500.00 outstanding')).toBeInTheDocument();
    // factor_rate wins over fee_bps.
    expect(inCard.getByText('8.5% fee')).toBeInTheDocument();
    expect(inCard.getByText('Repay $108.50 per $100 advanced')).toBeInTheDocument();
    expect(inCard.getByText('12% holdback')).toBeInTheDocument();
    expect(inCard.getByText('We collect 12% of each payout')).toBeInTheDocument();
    expect(inCard.getByText(/You're at the \$25k platform maximum/)).toBeInTheDocument();
    expect(inCard.getByText('uw-2026.06.1')).toBeInTheDocument();

    // Decision data replaces the legacy heuristic utilization view…
    expect(screen.queryByText('Credit Utilization')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /How is my credit determined/ }),
    ).not.toBeInTheDocument();
    // …and an approved provider can still request.
    expect(screen.getByRole('heading', { name: 'Request Advance' })).toBeInTheDocument();
    expect(screen.getByText('Up to $7,500.00 available')).toBeInTheDocument();
  });

  it('falls back to basis-point pricing, the standard tier and generic copy for a sparse decision', () => {
    setHooks({
      creditLimit: limit({ approved: true, fee_bps: 900, available_cents: 400000 }),
    });
    renderPage();

    const inCard = within(screen.getByRole('region', { name: 'Your working capital line' }));
    expect(inCard.getByText('Standard tier')).toBeInTheDocument();
    expect(inCard.getByText('9.0% fee')).toBeInTheDocument();
    expect(inCard.queryByText(/per \$100 advanced/)).not.toBeInTheDocument();
    expect(inCard.getByText('On each payout')).toBeInTheDocument();
    expect(inCard.queryByText(/We collect/)).not.toBeInTheDocument();
    // No outstanding suffix at a zero balance; headroom from legacy available_cents.
    expect(inCard.getByText('$10,000.00 total line')).toBeInTheDocument();
    expect(inCard.getByText('$4,000.00')).toBeInTheDocument();
    expect(
      inCard.getByText(/Complete more work and keep a clean repayment history/),
    ).toBeInTheDocument();
    // No model version → the audit line carries only the generic label.
    expect(inCard.getByText('Explainable decision')).toBeInTheDocument();
    expect(inCard.queryByText(/^uw-/)).not.toBeInTheDocument();
  });

  it('defers the fee to request time when the decision carries no pricing', () => {
    setHooks({ creditLimit: limit({ approved: true, factor_rate: 1 }) });
    renderPage();
    const inCard = within(screen.getByRole('region', { name: 'Your working capital line' }));
    expect(inCard.getByText('Shown at request')).toBeInTheDocument();
    expect(inCard.queryByText(/per \$100 advanced/)).not.toBeInTheDocument();
  });

  it.each([
    ['revenue_35pct', /Capped at 35% of your trailing-year earnings/],
    ['risk_multiple', /Based on your risk-adjusted earnings/],
  ] as const)('explains the %s binding cap', (bindingCap, hint) => {
    setHooks({ creditLimit: limit({ approved: true, binding_cap: bindingCap, tier: 'starter' }) });
    renderPage();
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(screen.getByText('Starter tier')).toBeInTheDocument();
  });
});

describe('ProviderAdvancesPage — declined credit decision', () => {
  it('lists the three worst risk drivers, worst first, and hides the request form', () => {
    setHooks({
      creditLimit: limit({
        approved: false,
        available_cents: 0,
        binding_gate: 'Dispute rate above the 5% ceiling.',
        model_version: 'uw-2026.06.1',
        reasons: [
          { code: 'tenure_short', label: 'Short tenure', contribution: 0.2 },
          { code: 'TRUST_HIGH', label: 'High trust score', contribution: -0.4 },
          { code: 'dispute_rate', label: 'Dispute rate', contribution: 0.9 },
          { code: 'volume_low', label: 'Low volume', contribution: 0.1 },
          { code: 'late_delivery', label: 'Late deliveries', contribution: 0.5 },
        ],
      }),
    });
    renderPage();

    const card = screen.getByRole('status', { name: 'No line available yet' });
    const inCard = within(card);
    expect(inCard.getByText(/Dispute rate above the 5% ceiling\./)).toBeInTheDocument();
    const drivers = inCard.getAllByRole('listitem').map((li) => li.querySelector('.font-medium')?.textContent);
    // Helpful (negative) factors are dropped; the 4th-worst driver is cut.
    expect(drivers).toEqual(['Dispute rate', 'Late deliveries', 'Short tenure']);
    expect(inCard.getByText(/Resolve open disputes/)).toBeInTheDocument();
    expect(inCard.getByText(/Deliver on schedule/)).toBeInTheDocument();
    expect(inCard.getByText(/Keep completing jobs — your line grows/)).toBeInTheDocument();
    expect(inCard.getByText('uw-2026.06.1')).toBeInTheDocument();

    expect(screen.queryByRole('heading', { name: 'Request Advance' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Amount/)).not.toBeInTheDocument();
    // History stays visible to a declined provider.
    expect(screen.getByRole('heading', { name: 'Advance History' })).toBeInTheDocument();
  });

  it('uses the generic ineligible copy and omits the blockers list without a gate or reasons', () => {
    setHooks({ creditLimit: limit({ approved: false, available_cents: 0 }) });
    renderPage();
    const inCard = within(screen.getByRole('status', { name: 'No line available yet' }));
    expect(
      inCard.getByText(/You're not eligible for a working-capital advance right now\./),
    ).toBeInTheDocument();
    expect(inCard.queryByText(/holding it back/)).not.toBeInTheDocument();
    expect(inCard.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('omits the blockers list when every factor lowers risk', () => {
    setHooks({
      creditLimit: limit({
        approved: false,
        reasons: [{ code: 'TRUST_HIGH', label: 'High trust score', contribution: -0.3 }],
      }),
    });
    renderPage();
    expect(screen.queryByText(/holding it back/)).not.toBeInTheDocument();
    expect(screen.queryByText('High trust score')).not.toBeInTheDocument();
  });

  it.each([
    ['AGE_ACCOUNT', /Keep completing jobs — your line grows/],
    ['earnings_low', /More completed contract value raises the ceiling/],
    ['REVENUE_THIN', /More completed contract value raises the ceiling/],
    ['ontime_rate', /Deliver on schedule/],
    ['DELIVERY_SLIP', /Deliver on schedule/],
    ['repay_history', /Repay advances on time/],
    ['DEFAULT_PRIOR', /Repay advances on time/],
    ['delinq_30', /Repay advances on time/],
    ['trust_low', /Build your trust score/],
  ])('gives targeted guidance for a %s reason', (code, guidance) => {
    setHooks({
      creditLimit: limit({
        approved: false,
        reasons: [{ code, label: 'Engine label', contribution: 0.5 }],
      }),
    });
    renderPage();
    expect(screen.getByText(guidance)).toBeInTheDocument();
  });

  it("falls back to the engine's own label for an unrecognised reason code", () => {
    setHooks({
      creditLimit: limit({
        approved: false,
        reasons: [{ code: 'KYC_PENDING', label: 'Identity check pending', contribution: 0.5 }],
      }),
    });
    renderPage();
    // Label is the heading and, with no mapped guidance, the body too.
    expect(screen.getAllByText('Identity check pending')).toHaveLength(2);
  });
});

describe('ProviderAdvancesPage — fee preview', () => {
  it('prices at the risk-based APR and shows the credit grade badge', () => {
    setHooks({
      creditLimit: limit({ apr_bps: 450, business_credit_score: 82, credit_grade: 'A' }),
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '1000' } });

    expect(screen.getByText('Credit A · 82/100')).toBeInTheDocument();
    expect(screen.getByText('Interest (4.50% APR · ~30-day term)')).toBeInTheDocument();
    // 100000 × 450bps × 30/365 = 370¢ interest; 3% service fee = 3000¢.
    expect(screen.getByText('$3.70')).toBeInTheDocument();
    expect(screen.getByText('$30.00')).toBeInTheDocument();
    expect(screen.getByLabelText('Total repayment: $1,033.70')).toBeInTheDocument();
  });

  it('prices at the 3% base APR with no badge when the payload is unpriced', () => {
    setHooks({ creditLimit: limit({ business_credit_score: 82 }) });
    renderPage();
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '1000' } });

    expect(screen.queryByText(/Credit .* · 82\/100/)).not.toBeInTheDocument();
    expect(screen.getByText('Interest (3.00% APR · ~30-day term)')).toBeInTheDocument();
    // 100000 × 300bps × 30/365 = 247¢.
    expect(screen.getByLabelText('Total repayment: $1,032.47')).toBeInTheDocument();
  });

  it.each(['0', '-25', 'abc'])('hides the preview and keeps submit disabled for amount "%s"', (value) => {
    const requestMutate = vi.fn<RequestMutate>();
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
      requestMutate,
    });
    renderPage();
    fireEvent.change(screen.getByTestId('advance-contract-select'), { target: { value: 'c1' } });
    const amount = screen.getByLabelText(/Amount/);
    fireEvent.change(amount, { target: { value } });

    expect(screen.queryByText('Fee Estimate')).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Request Advance' });
    expect(submit).toBeDisabled();
    const form = submit.closest('form');
    if (!form) throw new Error('request form not found');
    fireEvent.submit(form);
    expect(requestMutate).not.toHaveBeenCalled();
  });
});

describe('ProviderAdvancesPage — legacy heuristics without a credit-limit payload', () => {
  it('derives outstanding from disbursed + repaying advances and credit from active contracts', () => {
    setHooks({
      contracts: [
        { id: 'c1', contract_number: 'CN-1', amount_cents: 600000 },
        { id: 'c2', contract_number: 'CN-2', amount_cents: 400000 },
      ],
      advances: [
        advance({ id: 'a1', status: 'disbursed', advance_amount_cents: 100000, fee_cents: 0, repaid_cents: 0 }),
        advance({ id: 'a2', status: 'repaying', advance_amount_cents: 50000, fee_cents: 1000, repaid_cents: 11000 }),
        // Not outstanding: settled, pending and rejected advances are excluded.
        advance({ id: 'a3', status: 'repaid', advance_amount_cents: 70000, fee_cents: 0, repaid_cents: 70000 }),
        advance({ id: 'a4', status: 'requested', advance_amount_cents: 30000, fee_cents: 0, repaid_cents: 0 }),
        advance({ id: 'a5', status: 'rejected', advance_amount_cents: 20000, fee_cents: 0, repaid_cents: 0 }),
      ],
    });
    renderPage();

    expect(statValue('Total Advanced')).toBe('$2,700.00');
    // 100000 + (50000 + 1000 − 11000) = 140000.
    expect(statValue('Outstanding Balance')).toBe('$1,400.00');
    // 50% of $10,000 contract value − $1,400 outstanding.
    expect(statValue('Available Credit')).toBe('$3,600.00');
    expect(screen.getByText('$1,400.00 / $5,000.00')).toBeInTheDocument();

    const bar = screen.getByRole('progressbar', { name: 'Credit utilization: 28% used' });
    expect(bar).toHaveStyle({ width: '28%' });
    expect(bar).toHaveClass('bg-emerald-500/60');
    expect(screen.getByText('$3,600.00 available')).toBeInTheDocument();
    expect(screen.getByText('Up to $3,600.00 available')).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).toHaveAttribute('aria-describedby', 'advance-amount-hint');
  });

  it('never reports negative credit when outstanding exceeds the derived limit', () => {
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 100000 }],
      advances: [advance({ status: 'disbursed', advance_amount_cents: 90000, fee_cents: 0, repaid_cents: 0 })],
    });
    renderPage();
    expect(statValue('Available Credit')).toBe('$0.00');
    expect(
      screen.getByText('Fully utilized • $900.00 of $500.00 used • $0 available'),
    ).toBeInTheDocument();
    // No headroom → no "up to" hint and no dangling aria-describedby.
    expect(screen.queryByText(/^Up to/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).not.toHaveAttribute('aria-describedby');
  });

  it('renders a 0% bar when headroom is reported against a $0 limit', () => {
    setHooks({ creditLimit: limit({ max_advance_cents: 0, available_cents: 5000 }) });
    renderPage();
    const bar = screen.getByRole('progressbar', { name: 'Credit utilization: 0% used' });
    expect(bar).toHaveStyle({ width: '0%' });

    // The explanation panel derives its own limit from contract value (also $0).
    fireEvent.click(screen.getByRole('button', { name: /How is my credit determined/ }));
    expect(screen.getAllByRole('progressbar', { name: 'Credit utilization: 0% used' })).toHaveLength(2);
    expect(screen.getByText('Credit utilization')).toBeInTheDocument();
  });

  it('offers the empty-contracts notice in the contract picker', () => {
    setHooks({ contracts: [] });
    renderPage();
    expect(screen.getByText('No active contracts available')).toBeInTheDocument();
  });

  it('lists each active contract with its value in the contract picker', () => {
    setHooks({ contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1250000 }] });
    renderPage();
    expect(screen.getByRole('option', { name: 'CN-1 - $12,500.00' })).toHaveValue('c1');
    expect(screen.queryByText('No active contracts available')).not.toBeInTheDocument();
  });
});

describe('ProviderAdvancesPage — credit explanation panel', () => {
  function expand() {
    fireEvent.click(screen.getByRole('button', { name: /How is my credit determined/ }));
  }

  it('labels the panel bar fully utilized when no credit is left', () => {
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
      creditLimit: limit({ max_advance_cents: 500000, total_outstanding_cents: 500000, available_cents: 0 }),
    });
    renderPage();
    expand();
    expect(screen.getByText('Credit utilization — fully utilized')).toBeInTheDocument();
    expect(
      screen.getAllByRole('progressbar', { name: 'Credit fully utilized: 100% used, $0 available' }),
    ).toHaveLength(2);
    expect(screen.getByText('- $5,000.00')).toBeInTheDocument();
  });

  it.each([
    [300000, '60%', 'bg-amber-500/60'],
    [450000, '90%', 'bg-red-500/60'],
    [100000, '20%', 'bg-emerald-500/60'],
  ])('colours the panel bar for %i¢ outstanding (%s)', (outstanding, percent, colour) => {
    setHooks({
      contracts: [{ id: 'c1', contract_number: 'CN-1', amount_cents: 1000000 }],
      creditLimit: limit({
        max_advance_cents: 500000,
        total_outstanding_cents: outstanding,
        available_cents: 500000 - outstanding,
      }),
    });
    renderPage();
    expand();
    const bars = screen.getAllByRole('progressbar', {
      name: `Credit utilization: ${percent} used`,
    });
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar).toHaveClass(colour);
      expect(bar).toHaveStyle({ width: percent });
    }
  });

  it('collapses again on a second click', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: /How is my credit determined/ });
    fireEvent.click(toggle);
    expect(screen.getByText('Active contract value')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Active contract value')).not.toBeInTheDocument();
  });
});

describe('ProviderAdvancesPage — advance history rows', () => {
  it('shows the fee without a repaid suffix before any repayment', () => {
    setHooks({ advances: [advance({ status: 'approved', repaid_cents: 0 })] });
    renderPage();
    expect(screen.getByText('Fee: $25.00')).toBeInTheDocument();
    expect(screen.queryByText(/Repaid:/)).not.toBeInTheDocument();
    // Approved (not yet disbursed) advances have no repayment bar or repay action.
    expect(screen.queryByText('Repayment')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Repay advance/ })).not.toBeInTheDocument();
  });

  it('offers repayment on a disbursed advance, named by contract id when it has no number', () => {
    setHooks({
      advances: [
        advance({ status: 'disbursed', contract_number: undefined, fee_cents: 0, repaid_cents: 0 }),
      ],
    });
    renderPage();
    expect(
      screen.getByRole('button', { name: 'Repay advance aaaaaaaa ($1,000.00 outstanding)' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Fee:/)).not.toBeInTheDocument();
  });
});

describe('ProviderAdvancesPage — repay dialog', () => {
  function openDialog(name: RegExp = /Repay advance CN-100/) {
    fireEvent.click(screen.getByRole('button', { name }));
    return screen.getByRole('dialog');
  }

  it('refers to the contract id prefix when the advance has no contract number', () => {
    setHooks({ advances: [advance({ contract_number: undefined })] });
    renderPage();
    const dialog = openDialog(/Repay advance aaaaaaaa/);
    expect(within(dialog).getByText(/Pay down aaaaaaaa early/)).toBeInTheDocument();
    expect(within(dialog).getByText('Up to $525.00 can be repaid.')).toBeInTheDocument();
  });

  it('closes without repaying on Cancel', () => {
    const repayMutate = vi.fn<RepayMutate>();
    setHooks({ advances: [advance()], repayMutate });
    renderPage();
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(repayMutate).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    setHooks({ advances: [advance()] });
    renderPage();
    const dialog = openDialog();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the dialog once the repayment succeeds', () => {
    const repayMutate = vi.fn<RepayMutate>((_vars, opts) => {
      opts?.onSuccess?.();
    });
    setHooks({ advances: [advance()], repayMutate });
    renderPage();
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Repay $525.00' }));
    expect(repayMutate).toHaveBeenCalledWith(
      { advanceId: 'adv-1', amount_cents: 52500 },
      expect.objectContaining({ onSuccess: expect.any(Function) as unknown }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['', '0', '-10', 'abc'])('disables submit for the amount "%s"', (value) => {
    const repayMutate = vi.fn<RepayMutate>();
    setHooks({ advances: [advance()], repayMutate });
    renderPage();
    const dialog = openDialog();
    const input = within(dialog).getByLabelText(/Repayment amount/);
    fireEvent.change(input, { target: { value } });

    const submit = within(dialog).getByRole('button', { name: 'Repay' });
    expect(submit).toBeDisabled();
    // Not an over-balance error — the neutral hint stays.
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(within(dialog).getByText('Up to $525.00 can be repaid.')).toBeInTheDocument();
    const form = submit.closest('form');
    if (!form) throw new Error('repay form not found');
    fireEvent.submit(form);
    expect(repayMutate).not.toHaveBeenCalled();
  });

  it('flags an over-balance amount as invalid and refuses to submit it', () => {
    const repayMutate = vi.fn<RepayMutate>();
    setHooks({ advances: [advance()], repayMutate });
    renderPage();
    const dialog = openDialog();
    const input = within(dialog).getByLabelText(/Repayment amount/);
    fireEvent.change(input, { target: { value: '525.01' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Repayment amount exceeds the outstanding balance of $525.00.',
    );
    const form = input.closest('form');
    if (!form) throw new Error('repay form not found');
    fireEvent.submit(form);
    expect(repayMutate).not.toHaveBeenCalled();
  });

  it('locks the dialog while a repayment is in flight', () => {
    const repayMutate = vi.fn<RepayMutate>();
    setHooks({ advances: [advance()], repayMutate, repayPending: true });
    renderPage();
    const dialog = openDialog();
    const submit = within(dialog).getByRole('button', { name: 'Repay $525.00' });
    expect(submit).toBeDisabled();
    expect(submit.querySelector('.animate-spin')).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    const form = submit.closest('form');
    if (!form) throw new Error('repay form not found');
    fireEvent.submit(form);
    // A valid amount is still not double-submitted while pending.
    expect(repayMutate).not.toHaveBeenCalled();
  });

  it('swaps to a settled notice when the balance clears while the dialog is open', () => {
    setHooks({ advances: [advance()] });
    const view = renderPage();
    openDialog();
    expect(screen.getByLabelText(/Repayment amount/)).toBeInTheDocument();

    // A concurrent holdback settles the advance (refetch lands mid-dialog).
    setHooks({ advances: [advance({ repaid_cents: 102500 })] });
    view.rerender(page());

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'This advance is fully repaid — there is no remaining balance to pay down.',
    );
    expect(within(dialog).queryByLabelText(/Repayment amount/)).not.toBeInTheDocument();

    // The footer "Close" (the header X carries the same accessible name).
    const footerClose = within(dialog)
      .getAllByRole('button', { name: 'Close' })
      .find((button) => button.textContent === 'Close' && button.classList.contains('min-h-[44px]'));
    if (!footerClose) throw new Error('footer Close button not found');
    fireEvent.click(footerClose);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('drops the dialog when its advance disappears from the list', () => {
    setHooks({ advances: [advance()] });
    const view = renderPage();
    openDialog();
    setHooks({ advances: [] });
    view.rerender(page());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('No advances yet')).toBeInTheDocument();
  });
});
