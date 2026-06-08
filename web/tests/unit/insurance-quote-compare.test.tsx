import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureFlagKey } from '@/hooks/useFeatureFlags';
import type {
  InsuranceCompetitiveQuote,
  InsuranceQuoteRequestResponse,
  RequestInsuranceQuotesInput,
  SelectInsuranceQuoteResponse,
} from '@/types';

// ── Feature flag mock ───────────────────────────────────────────────────────
let flagState: Partial<Record<FeatureFlagKey, boolean>> = {};
vi.mock('@/hooks/useFeatureFlags', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useFeatureFlags')>(
      '@/hooks/useFeatureFlags',
    );
  return {
    ...actual,
    useFeatureFlags: () => flagState,
    useFeatureFlag: (key: FeatureFlagKey) => flagState[key] ?? true,
  };
});

// Avoid pulling the toast lib into the test.
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ── Marketplace hooks mock ──────────────────────────────────────────────────
const SAMPLE_QUOTES: InsuranceCompetitiveQuote[] = [
  {
    quote_id: 'q-cheap',
    insurer_id: 'ins-1',
    insurer_name: 'Acme Mutual',
    premium_cents: 4500,
    deductible_cents: 25000,
    terms: 'Full replacement, 30-day window.',
    expires_at: '2026-07-01T12:00:00Z',
  },
  {
    quote_id: 'q-pricey',
    insurer_id: 'ins-2',
    insurer_name: 'Globe Assurance',
    premium_cents: 6200,
    deductible_cents: 10000,
    terms: 'Lower deductible, partial coverage.',
    expires_at: '2026-07-02T12:00:00Z',
  },
];

let requestQuotesState: {
  data: InsuranceQuoteRequestResponse | undefined;
  isPending: boolean;
  isError: boolean;
};
const requestMutate = vi.fn();
const selectMutate = vi.fn();

vi.mock('@/hooks/useInsuranceMarketplace', () => ({
  useRequestQuotes: () => ({
    mutate: (input: RequestInsuranceQuotesInput) => {
      requestMutate(input);
    },
    data: requestQuotesState.data,
    isPending: requestQuotesState.isPending,
    isError: requestQuotesState.isError,
  }),
  useSelectQuote: () => ({
    mutate: (
      quoteId: string,
      opts?: {
        onSuccess?: (data: SelectInsuranceQuoteResponse) => void;
      },
    ) => {
      selectMutate(quoteId);
      opts?.onSuccess?.({ policy_id: 'POL-9001', status: 'active' });
    },
    isPending: false,
    variables: undefined,
  }),
}));

const { InsuranceQuoteCompare } = await import(
  '@/components/insurance/InsuranceQuoteCompare'
);

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(createElement(QueryClientProvider, { client }, ui));
}

beforeEach(() => {
  flagState = { insurance_competition: true };
  requestQuotesState = { data: undefined, isPending: false, isError: false };
  requestMutate.mockClear();
  selectMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InsuranceQuoteCompare — flag gating', () => {
  it('renders nothing when insurance_competition is OFF', () => {
    flagState = { insurance_competition: false };
    const { container } = renderWithClient(
      createElement(InsuranceQuoteCompare, {}),
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByText('Compare insurance quotes'),
    ).not.toBeInTheDocument();
  });

  it('renders the quote request form when the flag is ON', () => {
    renderWithClient(createElement(InsuranceQuoteCompare, {}));
    expect(screen.getByText('Compare insurance quotes')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Coverage amount (USD)'),
    ).toBeInTheDocument();
  });
});

describe('InsuranceQuoteCompare — request → compare → select', () => {
  it('submits a quote request with coverage converted to cents', async () => {
    const user = userEvent.setup();
    renderWithClient(
      createElement(InsuranceQuoteCompare, { contractId: 'c-123' }),
    );

    const coverage = screen.getByLabelText('Coverage amount (USD)');
    await user.type(coverage, '5000');
    await user.click(
      screen.getByRole('button', { name: /get competing quotes/i }),
    );

    expect(requestMutate).toHaveBeenCalledTimes(1);
    expect(requestMutate).toHaveBeenCalledWith({
      product_type: 'completion_guarantee',
      coverage_cents: 500000,
      contract_id: 'c-123',
    });
  });

  it('shows the competing quotes with the cheapest highlighted', () => {
    requestQuotesState = {
      data: { request_id: 'req-1', quotes: SAMPLE_QUOTES },
      isPending: false,
      isError: false,
    };
    renderWithClient(createElement(InsuranceQuoteCompare, {}));

    // Both insurers shown.
    expect(screen.getByText('Acme Mutual')).toBeInTheDocument();
    expect(screen.getByText('Globe Assurance')).toBeInTheDocument();
    // Premiums formatted from integer cents.
    expect(screen.getByText('$45.00')).toBeInTheDocument();
    expect(screen.getByText('$62.00')).toBeInTheDocument();
    // Cheapest gets the "Lowest premium" badge.
    expect(screen.getByText('Lowest premium')).toBeInTheDocument();
  });

  it('binds the chosen insurer and shows a success confirmation', async () => {
    const user = userEvent.setup();
    requestQuotesState = {
      data: { request_id: 'req-1', quotes: SAMPLE_QUOTES },
      isPending: false,
      isError: false,
    };
    renderWithClient(createElement(InsuranceQuoteCompare, {}));

    await user.click(
      screen.getByRole('button', { name: /select globe assurance/i }),
    );

    expect(selectMutate).toHaveBeenCalledWith('q-pricey');
    await waitFor(() => {
      expect(screen.getByText("You're covered")).toBeInTheDocument();
    });
    expect(screen.getByText(/POL-9001 is active/)).toBeInTheDocument();
  });

  it('shows an empty state when no insurers compete', () => {
    requestQuotesState = {
      data: { request_id: 'req-empty', quotes: [] },
      isPending: false,
      isError: false,
    };
    renderWithClient(createElement(InsuranceQuoteCompare, {}));
    expect(
      screen.getByText('No insurers competing yet'),
    ).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    requestQuotesState = { data: undefined, isPending: false, isError: true };
    renderWithClient(createElement(InsuranceQuoteCompare, {}));
    expect(screen.getByText("Couldn't get quotes")).toBeInTheDocument();
  });
});
