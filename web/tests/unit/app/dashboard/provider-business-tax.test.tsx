// Tests for the provider tax forms page — exercises loading, earnings render,
// 1099 generate handler, download handler, and quarterly breakdown.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const earningsState: {
  data: {
    net_earnings_cents: number;
    total_jobs: number;
    total_fees_cents: number;
    data_points?: { period_start: string; earnings_cents: number; job_count: number }[];
  } | undefined;
  isLoading: boolean;
} = { data: undefined, isLoading: false };

const taxFormsState: {
  data: {
    forms: { id: string; form_type: string; tax_year: number; generated_at: string; status: string }[];
  } | undefined;
  isLoading: boolean;
} = { data: undefined, isLoading: false };

// Authoritative server-computed tax estimate (integer cents + 0..1 rates). The
// page reads these verbatim from useTaxEstimate and never recomputes the tax —
// see gateway/internal/handler/tax_estimate_calc.go for the source of truth.
// Figures below are internally consistent for ~$50,000 net self-employment
// income: SE tax (15.3%), federal income tax, CA state, total + effective rate.
const ESTIMATE_FIXTURE = {
  tax_year: 2026,
  net_earnings_cents: 5_000_000,
  se_calc_base_cents: 4_617_500,
  se_tax_cents: 706_478, // 15.3% of SE base
  se_tax_rate: 0.153,
  half_se_tax_deduction_cents: 353_239,
  standard_deduction_cents: 1_500_000,
  federal_taxable_cents: 3_146_761,
  federal_income_tax_cents: 354_000,
  state_code: 'CA',
  state_tax_rate: 0.04,
  state_income_tax_cents: 188_000,
  has_state_data: true,
  total_tax_cents: 1_248_478, // SE + federal + state
  effective_rate: 0.2497, // total_tax / net_earnings
};

const taxEstimateState: {
  data: { tax_estimate: typeof ESTIMATE_FIXTURE } | undefined;
  isLoading: boolean;
} = { data: { tax_estimate: ESTIMATE_FIXTURE }, isLoading: false };

const generateMutate = vi.fn();
const generateState = { isPending: false, isError: false };
const downloadAuth = vi.fn((..._args: unknown[]) => Promise.resolve());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/business/tax',
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

vi.mock('@/hooks/useAnalytics', () => ({
  useProviderEarnings: () => earningsState,
}));

vi.mock('@/hooks/useTaxForms', () => ({
  useGenerateTaxForm: () => ({
    mutate: generateMutate,
    isPending: generateState.isPending,
    isError: generateState.isError,
  }),
  useTaxForms: () => taxFormsState,
  // New server-side tax estimate the page now reads instead of computing a flat
  // client-side number. Returns the authoritative integer-cent breakdown.
  useTaxEstimate: () => taxEstimateState,
}));

vi.mock('@/lib/api', () => ({
  downloadAuthenticated: (...args: unknown[]) => downloadAuth(...args),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getApiErrorMessage: (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import ProviderTaxPage from '@/app/(dashboard)/provider/business/tax/page';

beforeEach(() => {
  earningsState.data = undefined;
  earningsState.isLoading = false;
  taxFormsState.data = undefined;
  taxFormsState.isLoading = false;
  taxEstimateState.data = { tax_estimate: ESTIMATE_FIXTURE };
  taxEstimateState.isLoading = false;
  generateState.isPending = false;
  generateState.isError = false;
  generateMutate.mockReset();
  downloadAuth.mockReset();
  downloadAuth.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderTaxPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderTaxPage)));
    expect(container).toBeTruthy();
  });

  it('renders the transparent server-computed tax breakdown (SE + federal + state + effective rate)', () => {
    earningsState.data = {
      net_earnings_cents: 5_000_000,
      total_jobs: 12,
      total_fees_cents: 250_000,
    };
    render(withQueryClient(createElement(ProviderTaxPage)));

    // The breakdown LABELS appear in both the on-screen card (annual /yr) and
    // the print-only summary (quarterly /quarter), so assert label presence with
    // getAllByText and pin the on-screen ANNUAL dollar figures with getByText.
    //
    // SE tax line carries its rate label (15.3%) and the server's annual figure.
    expect(screen.getAllByText(/Self-Employment Tax \(15\.3%\)/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$7,064.78/yr')).toBeDefined();
    // Federal income tax — annual, verbatim from the estimate.
    expect(screen.getAllByText('Federal Income Tax').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$3,540.00/yr')).toBeDefined();
    // State income tax surfaces the state code + its rate, and the annual figure.
    expect(
      screen.getAllByText(/State Income Tax\s*\(CA · 4\.00%\)/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$1,880.00/yr')).toBeDefined();
    // Est. annual total + effective rate badge (total_tax / net_earnings).
    expect(screen.getByText('$12,484.78')).toBeDefined();
    expect(screen.getAllByText(/\(25\.0% effective\)/).length).toBeGreaterThanOrEqual(1);
    // Quarterly estimated payment = annual total ÷ 4, shown on-screen.
    expect(screen.getByText('$3,121.20/quarter')).toBeDefined();
  });

  it('shows the no-state-data notice when the estimate lacks a state', () => {
    earningsState.data = { net_earnings_cents: 5_000_000, total_jobs: 1, total_fees_cents: 0 };
    taxEstimateState.data = {
      tax_estimate: {
        ...ESTIMATE_FIXTURE,
        state_code: '',
        state_tax_rate: 0,
        state_income_tax_cents: 0,
        has_state_data: false,
      },
    };
    render(withQueryClient(createElement(ProviderTaxPage)));
    expect(
      screen.getByText(/couldn.t determine your state from your completed jobs/i),
    ).toBeDefined();
  });

  it('shows loading skeletons while earnings are loading', () => {
    earningsState.isLoading = true;
    render(withQueryClient(createElement(ProviderTaxPage)));
    expect(screen.getByText(/Tax Center/)).toBeDefined();
  });

  it('shows the Will Receive 1099 badge when earnings exceed the threshold', () => {
    earningsState.data = {
      net_earnings_cents: 100_000,
      total_jobs: 5,
      total_fees_cents: 1500,
    };
    render(withQueryClient(createElement(ProviderTaxPage)));
    // The on-screen badge plus the print-only summary both surface this text.
    expect(screen.getAllByText(/Will Receive 1099/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the Below Threshold badge when earnings are under the threshold', () => {
    earningsState.data = {
      net_earnings_cents: 1000,
      total_jobs: 1,
      total_fees_cents: 100,
    };
    render(withQueryClient(createElement(ProviderTaxPage)));
    // The on-screen badge plus the print-only summary both surface this text.
    expect(screen.getAllByText(/Below Threshold/i).length).toBeGreaterThanOrEqual(1);
  });

  it('clicking Generate 1099-NEC fires the generate mutation with the parsed year', () => {
    earningsState.data = {
      net_earnings_cents: 0,
      total_jobs: 0,
      total_fees_cents: 0,
    };
    render(withQueryClient(createElement(ProviderTaxPage)));
    const btn = screen.getByRole('button', { name: /Generate 1099-NEC/i });
    fireEvent.click(btn);
    expect(generateMutate).toHaveBeenCalledTimes(1);
    expect(typeof generateMutate.mock.calls[0]?.[0]).toBe('number');
  });

  it('renders the Quarterly Breakdown card when data_points exist', () => {
    earningsState.data = {
      net_earnings_cents: 50_000,
      total_jobs: 2,
      total_fees_cents: 500,
      data_points: [
        { period_start: '2026-01-01T00:00:00Z', earnings_cents: 25_000, job_count: 1 },
        { period_start: '2026-04-01T00:00:00Z', earnings_cents: 25_000, job_count: 1 },
      ],
    };
    render(withQueryClient(createElement(ProviderTaxPage)));
    // Heading appears in both the on-screen card and the print-only summary.
    expect(screen.getAllByText('Quarterly Breakdown').length).toBeGreaterThanOrEqual(1);
  });

  it('renders existing tax forms with Download button', () => {
    earningsState.data = {
      net_earnings_cents: 80_000,
      total_jobs: 3,
      total_fees_cents: 1000,
    };
    taxFormsState.data = {
      forms: [
        {
          id: 'tf-1',
          form_type: '1099-NEC',
          tax_year: 2025,
          generated_at: '2026-01-15T00:00:00Z',
          status: 'ready',
        },
      ],
    };
    render(withQueryClient(createElement(ProviderTaxPage)));
    expect(screen.getByText(/1099-NEC - 2025/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /^Download$/i }));
    expect(downloadAuth).toHaveBeenCalled();
  });

  it('shows the generation error banner when isError is true', () => {
    earningsState.data = { net_earnings_cents: 0, total_jobs: 0, total_fees_cents: 0 };
    generateState.isError = true;
    render(withQueryClient(createElement(ProviderTaxPage)));
    expect(screen.getByText(/Failed to generate tax form/i)).toBeDefined();
  });

  it('clicking Print Summary triggers a scoped window.print', () => {
    earningsState.data = { net_earnings_cents: 0, total_jobs: 0, total_fees_cents: 0 };
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(withQueryClient(createElement(ProviderTaxPage)));
    fireEvent.click(screen.getByRole('button', { name: /Print Summary/i }));
    expect(printSpy).toHaveBeenCalled();
    // The print is scoped via the body class so only .print-region prints.
    expect(document.body.classList.contains('printing-region')).toBe(true);
    printSpy.mockRestore();
    document.body.classList.remove('printing-region');
  });

  it('renders the no-tax-forms placeholder when forms list is empty', () => {
    earningsState.data = { net_earnings_cents: 0, total_jobs: 0, total_fees_cents: 0 };
    taxFormsState.data = { forms: [] };
    render(withQueryClient(createElement(ProviderTaxPage)));
    expect(screen.getByText(/No tax forms generated yet/i)).toBeDefined();
  });

  it('shows the spinner Loader2 icon while the generate mutation is pending', () => {
    earningsState.data = { net_earnings_cents: 0, total_jobs: 0, total_fees_cents: 0 };
    generateState.isPending = true;
    const { container } = render(withQueryClient(createElement(ProviderTaxPage)));
    // The Loader2 icon has the animate-spin class — covers source line 267.
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    // Pending state disables the generate button.
    const btn = screen.getByRole('button', { name: /Generate 1099-NEC/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders skeletons while existing tax forms are loading', () => {
    earningsState.data = { net_earnings_cents: 0, total_jobs: 0, total_fees_cents: 0 };
    taxFormsState.isLoading = true;
    taxFormsState.data = undefined;
    const { container } = render(withQueryClient(createElement(ProviderTaxPage)));
    // The form-list skeleton block — covers source lines 282-285.
    const skeletons = container.querySelectorAll('.h-12.w-full');
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows toast.error when the download mutation rejects with an Error', async () => {
    const sonner = await import('sonner');
    const errorSpy = vi.spyOn(sonner.toast, 'error').mockImplementation(() => 'id-1');
    downloadAuth.mockReset();
    downloadAuth.mockRejectedValueOnce(new Error('Download failed: server is on fire'));

    earningsState.data = { net_earnings_cents: 80_000, total_jobs: 3, total_fees_cents: 1000 };
    taxFormsState.data = {
      forms: [
        {
          id: 'tf-err',
          form_type: '1099-NEC',
          tax_year: 2025,
          generated_at: '2026-01-15T00:00:00Z',
          status: 'ready',
        },
      ],
    };
    render(withQueryClient(createElement(ProviderTaxPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Download$/i }));

    // Wait for the rejected promise's catch handler to fire.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errorSpy).toHaveBeenCalled();
    const lastCall = errorSpy.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatch(/Download failed: server is on fire/);
    errorSpy.mockRestore();
  });

  it('shows fallback toast.error message when the download rejects with a non-Error', async () => {
    const sonner = await import('sonner');
    const errorSpy = vi.spyOn(sonner.toast, 'error').mockImplementation(() => 'id-2');
    downloadAuth.mockReset();
    // Reject with a non-Error so the `instanceof Error ? ... : 'Failed to download tax form'`
    // branch picks the fallback message.
    downloadAuth.mockRejectedValueOnce('weird non-error string');

    earningsState.data = { net_earnings_cents: 80_000, total_jobs: 3, total_fees_cents: 1000 };
    taxFormsState.data = {
      forms: [
        {
          id: 'tf-fallback',
          form_type: '1099-NEC',
          tax_year: 2025,
          generated_at: '2026-01-15T00:00:00Z',
          status: 'ready',
        },
      ],
    };
    render(withQueryClient(createElement(ProviderTaxPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Download$/i }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.at(-1)?.[0]).toBe('Failed to download tax form');
    errorSpy.mockRestore();
  });
});
