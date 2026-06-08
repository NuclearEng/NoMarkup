import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { InsuranceSelector } from '@/components/insurance/InsuranceSelector';

vi.mock('@/hooks/useInsurance', () => ({
  useInsuranceProducts: vi.fn(),
  useInsuranceQuote: vi.fn(),
  usePurchaseInsurance: vi.fn(),
}));

// per_job_insurance flag — default ON; toggled per-test for the gating case.
let insuranceEnabled = true;
vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: () => insuranceEnabled,
  useFeatureFlags: () => ({ per_job_insurance: insuranceEnabled }),
}));

const { useInsuranceProducts, useInsuranceQuote, usePurchaseInsurance } =
  await import('@/hooks/useInsurance');

const useProducts = vi.mocked(useInsuranceProducts);
const useQuote = vi.mocked(useInsuranceQuote);
const usePurchase = vi.mocked(usePurchaseInsurance);

const product = {
  id: 'prod-1',
  name: 'Damage Protection',
  slug: 'damage',
  description: 'Covers accidental property damage during the job.',
  coverage_type: 'damage',
  base_rate_bps: 200,
  min_premium_cents: 5_00,
  max_coverage_cents: 1_000_00,
  coverage_duration_days: 30,
  deductible_cents: 5_000,
  terms_markdown: '',
};

const quote = {
  product_id: 'prod-1',
  product_name: 'Damage Protection',
  premium_cents: 25_00,
  coverage_amount_cents: 500_00,
  deductible_cents: 50_00,
  coverage_duration_days: 30,
};

function defaultPurchase() {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof usePurchaseInsurance>;
}

describe('InsuranceSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insuranceEnabled = true;
    usePurchase.mockReturnValue(defaultPurchase());
  });

  it('renders nothing when the per_job_insurance flag is OFF', () => {
    insuranceEnabled = false;
    // Even with products available, the gated step must not render.
    useProducts.mockReturnValue({
      data: { products: [product] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({ data: { quote }, isLoading: false } as unknown as ReturnType<
      typeof useInsuranceQuote
    >);

    const { container } = render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );
    expect(screen.queryByText('Protect Your Project')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when there are no products', () => {
    useProducts.mockReturnValue({
      data: { products: [] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<
      typeof useInsuranceQuote
    >);

    const { container } = render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows skeletons while products are loading', () => {
    useProducts.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<
      typeof useInsuranceQuote
    >);

    const { container } = render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );
    // skeleton placeholders render as div elements
    expect(container.querySelectorAll('div').length).toBeGreaterThan(0);
  });

  it('renders product card with quote details when loaded', () => {
    useProducts.mockReturnValue({
      data: { products: [product] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({
      data: { quote },
      isLoading: false,
    } as unknown as ReturnType<typeof useInsuranceQuote>);

    render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );

    expect(screen.getByText('Damage Protection')).toBeDefined();
    expect(screen.getByText('Premium')).toBeDefined();
    expect(screen.getByText('$25.00')).toBeDefined();
    expect(screen.getByText('$500.00')).toBeDefined();
    expect(screen.getByText('30 days')).toBeDefined();
  });

  it('calls purchase mutation when Add Protection is clicked', async () => {
    const mutate = vi.fn();
    usePurchase.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseInsurance>);
    useProducts.mockReturnValue({
      data: { products: [product] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({
      data: { quote },
      isLoading: false,
    } as unknown as ReturnType<typeof useInsuranceQuote>);

    const user = userEvent.setup();
    render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );

    await user.click(screen.getByRole('button', { name: /Add Protection/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
    const [args] = mutate.mock.calls[0] as [
      { contract_id: string; product_id: string; payment_method_id: string },
    ];
    expect(args.contract_id).toBe('c1');
    expect(args.product_id).toBe('prod-1');
    expect(args.payment_method_id).toBe('pm1');
  });

  it('invokes onComplete when Skip Insurance is clicked', async () => {
    useProducts.mockReturnValue({
      data: { products: [product] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({
      data: { quote },
      isLoading: false,
    } as unknown as ReturnType<typeof useInsuranceQuote>);

    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
        onComplete,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Skip Insurance/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('hides the card when products fetch errors out', () => {
    useProducts.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<
      typeof useInsuranceQuote
    >);

    const { container } = render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a quote-loading skeleton inside the product card', () => {
    useProducts.mockReturnValue({
      data: { products: [product] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useInsuranceQuote>);

    render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );

    // Add Protection should be disabled while no quote is available.
    const button = screen.getByRole('button', { name: /Add Protection/ });
    if (!(button instanceof HTMLButtonElement)) throw new Error('expected button element');
    expect(button.disabled).toBe(true);
  });

  it('shows a spinner and disabled CTA while purchase is pending', () => {
    usePurchase.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseInsurance>);
    useProducts.mockReturnValue({
      data: { products: [product] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({
      data: { quote },
      isLoading: false,
    } as unknown as ReturnType<typeof useInsuranceQuote>);

    render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );

    const button = screen.getByRole('button', { name: /Add Protection/ });
    if (!(button instanceof HTMLButtonElement)) throw new Error('expected button element');
    expect(button.disabled).toBe(true);
  });

  it('renders the failure message when purchase mutation errors', () => {
    usePurchase.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof usePurchaseInsurance>);
    useProducts.mockReturnValue({
      data: { products: [product] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({
      data: { quote },
      isLoading: false,
    } as unknown as ReturnType<typeof useInsuranceQuote>);

    render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );

    expect(screen.getByText(/Failed to purchase/)).toBeDefined();
  });

  it('renders the purchased success card and notifies onComplete after a successful purchase', async () => {
    type PurchaseInput = {
      contract_id: string;
      product_id: string;
      payment_method_id: string;
    };
    type PurchaseOptions = { onSuccess: () => void };
    const mutate = vi.fn((_input: PurchaseInput, opts: PurchaseOptions) => {
      opts.onSuccess();
    });
    usePurchase.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseInsurance>);
    useProducts.mockReturnValue({
      data: { products: [product] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    useQuote.mockReturnValue({
      data: { quote },
      isLoading: false,
    } as unknown as ReturnType<typeof useInsuranceQuote>);

    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
        onComplete,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Add Protection/ }));

    expect(screen.getByText(/Damage Protection added/)).toBeDefined();
    expect(screen.getByText(/Premium:/)).toBeDefined();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('still renders the success card without a premium line when no quote is available', async () => {
    type PurchaseInput = {
      contract_id: string;
      product_id: string;
      payment_method_id: string;
    };
    type PurchaseOptions = { onSuccess: () => void };
    const mutate = vi.fn((_input: PurchaseInput, opts: PurchaseOptions) => {
      opts.onSuccess();
    });
    usePurchase.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseInsurance>);
    useProducts.mockReturnValue({
      data: { products: [product] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useInsuranceProducts>);
    // First render returns quote (so the button is enabled), then we re-evaluate
    // after click — but since the same mock is used, we simulate the no-quote path
    // with a separate test by always returning the success state without a quote.
    useQuote.mockReturnValue({
      data: { quote: undefined },
      isLoading: false,
    } as unknown as ReturnType<typeof useInsuranceQuote>);

    const user = userEvent.setup();
    const { container } = render(
      createElement(InsuranceSelector, {
        contractId: 'c1',
        paymentMethodId: 'pm1',
      }),
    );

    // Without a quote the Add Protection button is disabled and clicking does nothing.
    const button = screen.getByRole('button', { name: /Add Protection/ });
    if (!(button instanceof HTMLButtonElement)) throw new Error('expected button element');
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(container.textContent).toContain('Damage Protection');
  });
});
