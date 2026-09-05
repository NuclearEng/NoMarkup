import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstallmentPlanSelector } from '@/components/payments/InstallmentPlanSelector';
import type { PaymentMethod } from '@/types';

// The create mutation is mocked so the component can be tested without the api
// client. `createState` is mutated per-case; `mutate` records its args.
const mutate = vi.fn();
const createState = { isPending: false, isError: false };
vi.mock('@/hooks/useInstallments', () => ({
  useCreateInstallmentPlan: () => ({ mutate, ...createState }),
}));

// Default payment method available unless a test empties the list.
let methods: PaymentMethod[] = [
  {
    id: 'pm-default',
    type: 'card',
    last_four: '4242',
    brand: 'visa',
    exp_month: 12,
    exp_year: 2030,
    is_default: true,
  },
];
let methodsLoading = false;
vi.mock('@/hooks/usePayments', () => ({
  usePaymentMethods: () => ({
    data: { payment_methods: methods },
    isLoading: methodsLoading,
  }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

const baseProps = {
  totalCents: 100_00,
  contractId: 'c-1',
  providerId: 'prov-1',
};

describe('InstallmentPlanSelector', () => {
  beforeEach(() => {
    mutate.mockReset();
    createState.isPending = false;
    createState.isError = false;
    methodsLoading = false;
    methods = [
      {
        id: 'pm-default',
        type: 'card',
        last_four: '4242',
        brand: 'visa',
        exp_month: 12,
        exp_year: 2030,
        is_default: true,
      },
    ];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the three plan options', () => {
    render(createElement(InstallmentPlanSelector, baseProps));
    expect(screen.getByText('Pay in Full')).toBeDefined();
    expect(screen.getByText('3 Payments')).toBeDefined();
    expect(screen.getByText('6 Payments')).toBeDefined();
  });

  it('shows financing fee labels for the multi-payment plans', () => {
    render(createElement(InstallmentPlanSelector, baseProps));
    expect(screen.getByText('3% financing fee')).toBeDefined();
    expect(screen.getByText('5% financing fee')).toBeDefined();
  });

  it('defaults to "Pay in Full" being pressed and shows no confirm button', () => {
    render(createElement(InstallmentPlanSelector, baseProps));
    const payInFull = screen.getByRole('button', { name: /Pay in Full/ });
    expect(payInFull.getAttribute('aria-pressed')).toBe('true');
    // Pay-in-full creates no plan, so no "Set up N payments" CTA is shown.
    expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull();
  });

  it('creates a 3-installment plan with header-bound idempotency input on confirm', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(createElement(InstallmentPlanSelector, { ...baseProps, onCreated }));

    await user.click(screen.getByRole('button', { name: /3 Payments/ }));
    await user.click(screen.getByRole('button', { name: /Set up 3 payments/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const input = mutate.mock.calls[0]?.[0] as {
      contract_id: string;
      provider_id: string;
      installment_count: number;
      payment_method_id: string;
      idempotency_key: string;
    };
    expect(input.contract_id).toBe('c-1');
    expect(input.provider_id).toBe('prov-1');
    expect(input.installment_count).toBe(3);
    expect(input.payment_method_id).toBe('pm-default');
    expect(input.idempotency_key.length).toBeGreaterThan(0);
  });

  it('prompts to add a payment method when none exist', async () => {
    const user = userEvent.setup();
    methods = [];
    render(createElement(InstallmentPlanSelector, baseProps));

    await user.click(screen.getByRole('button', { name: /6 Payments/ }));
    expect(screen.getByText(/Add a/)).toBeDefined();
    expect(screen.getByRole('link', { name: /payment method/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull();
  });

  it('surfaces an inline error when plan creation fails', () => {
    createState.isError = true;
    render(createElement(InstallmentPlanSelector, baseProps));
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('disables the plan fieldset while the create is pending', () => {
    createState.isPending = true;
    const { container } = render(createElement(InstallmentPlanSelector, baseProps));
    // The fieldset wraps and disables all plan buttons during submission.
    const fieldset = container.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(true);
  });
});
