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

const generateMutate = vi.fn();
const generateState = { isPending: false, isError: false };
const downloadAuth = vi.fn(() => Promise.resolve());

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
}));

vi.mock('@/lib/api', () => ({
  downloadAuthenticated: (...args: unknown[]) => downloadAuth(...args),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
    expect(screen.getByText(/Will Receive 1099/i)).toBeDefined();
  });

  it('shows the Below Threshold badge when earnings are under the threshold', () => {
    earningsState.data = {
      net_earnings_cents: 1000,
      total_jobs: 1,
      total_fees_cents: 100,
    };
    render(withQueryClient(createElement(ProviderTaxPage)));
    expect(screen.getByText(/Below Threshold/i)).toBeDefined();
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
    expect(screen.getByText('Quarterly Breakdown')).toBeDefined();
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

  it('clicking Download Summary triggers window.print', () => {
    earningsState.data = { net_earnings_cents: 0, total_jobs: 0, total_fees_cents: 0 };
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(withQueryClient(createElement(ProviderTaxPage)));
    fireEvent.click(screen.getByRole('button', { name: /Download Summary/i }));
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('renders the no-tax-forms placeholder when forms list is empty', () => {
    earningsState.data = { net_earnings_cents: 0, total_jobs: 0, total_fees_cents: 0 };
    taxFormsState.data = { forms: [] };
    render(withQueryClient(createElement(ProviderTaxPage)));
    expect(screen.getByText(/No tax forms generated yet/i)).toBeDefined();
  });
});
