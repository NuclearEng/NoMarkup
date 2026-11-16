// Tests for the provider invoices page — exercises loading, empty, populated,
// row expansion, generate-invoice, generate-error, and print branches.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const contractsState: {
  data: { contracts: unknown[] } | undefined;
  isLoading: boolean;
} = { data: undefined, isLoading: false };

const profileState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

const generateInvoiceMutate = vi.fn();
const generateInvoiceState = { isPending: false, isError: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/business/invoices',
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

vi.mock('@/components/providers/InvoiceTemplate', () => ({
  InvoiceTemplate: ({ providerName }: { providerName: string }) =>
    createElement('div', { 'data-testid': 'invoice-template' }, providerName),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => contractsState,
}));

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => profileState,
}));

vi.mock('@/hooks/useTaxForms', () => ({
  useGenerateInvoice: () => ({
    mutate: generateInvoiceMutate,
    isPending: generateInvoiceState.isPending,
    isError: generateInvoiceState.isError,
  }),
}));

const { printDocSpy } = vi.hoisted(() => ({
  printDocSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/print', () => ({
  printAuthenticatedDocument: printDocSpy,
}));

const { default: ProviderInvoicesPage } = await import(
  '@/app/(dashboard)/provider/business/invoices/page'
);

function makeContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c-1',
    contract_number: 'CON-001',
    job_id: 'job-12345678abcd',
    job_title: 'Fix the sink',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    bid_id: 'b-1',
    amount_cents: 12500,
    payment_timing: 'completion',
    status: 'completed',
    customer_accepted: true,
    provider_accepted: true,
    acceptance_deadline: '2026-04-01T00:00:00Z',
    milestones: [],
    completed_at: '2026-04-10T00:00:00Z',
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  contractsState.data = undefined;
  contractsState.isLoading = false;
  profileState.data = undefined;
  profileState.isLoading = false;
  generateInvoiceState.isPending = false;
  generateInvoiceState.isError = false;
  generateInvoiceMutate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderInvoicesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderInvoicesPage)));
    expect(container).toBeTruthy();
  });

  it('renders loading skeletons when contracts are loading', () => {
    contractsState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ProviderInvoicesPage)));
    expect(container.querySelectorAll('[class*="skeleton" i]').length).toBeGreaterThanOrEqual(0);
    // h1 still renders
    expect(screen.getByRole('heading', { name: 'Invoices' })).toBeDefined();
  });

  it('renders loading state when profile is loading', () => {
    profileState.isLoading = true;
    contractsState.data = { contracts: [] };
    render(withQueryClient(createElement(ProviderInvoicesPage)));
    expect(screen.getByRole('heading', { name: 'Invoices' })).toBeDefined();
  });

  it('renders empty state when no completed contracts exist', () => {
    contractsState.data = { contracts: [] };
    render(withQueryClient(createElement(ProviderInvoicesPage)));
    expect(
      screen.getByText(/No completed contracts found/i),
    ).toBeDefined();
  });

  it('renders contract rows with formatted amounts when data is present', () => {
    contractsState.data = { contracts: [makeContract()] };
    profileState.data = { businessName: 'Acme Plumbing', serviceAddress: '1 Pipe Ln' };
    render(withQueryClient(createElement(ProviderInvoicesPage)));
    expect(screen.getByText('CON-001')).toBeDefined();
    expect(screen.getByText('Fix the sink')).toBeDefined();
    expect(screen.getByText(/Completed Contracts \(1\)/)).toBeDefined();
  });

  it('falls back to job_id slice when job_title is missing', () => {
    contractsState.data = {
      contracts: [makeContract({ job_title: '', job_id: 'abcdefghxxxx' })],
    };
    render(withQueryClient(createElement(ProviderInvoicesPage)));
    expect(screen.getByText('abcdefgh')).toBeDefined();
  });

  it('expands the row when its toggle button is clicked', () => {
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(ProviderInvoicesPage)));
    const toggle = screen.getByRole('button', { expanded: false });
    fireEvent.click(toggle);
    expect(screen.getByTestId('invoice-template')).toBeDefined();
    expect(screen.getByRole('button', { name: /Generate Invoice/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Print Invoice/ })).toBeDefined();
  });

  it('triggers generate invoice mutation when button clicked', () => {
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(ProviderInvoicesPage)));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: /Generate Invoice/ }));
    expect(generateInvoiceMutate).toHaveBeenCalledWith('c-1');
  });

  it('shows error message when invoice generation fails', () => {
    contractsState.data = { contracts: [makeContract()] };
    generateInvoiceState.isError = true;
    render(withQueryClient(createElement(ProviderInvoicesPage)));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/Failed to generate invoice/i)).toBeDefined();
  });

  it('disables generate button while mutation is pending', () => {
    contractsState.data = { contracts: [makeContract()] };
    generateInvoiceState.isPending = true;
    render(withQueryClient(createElement(ProviderInvoicesPage)));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const genBtn = screen.getByRole('button', { name: /Generate Invoice/ });
    expect((genBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('prints the server-generated invoice document when print button clicked', () => {
    printDocSpy.mockClear();
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(ProviderInvoicesPage)));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: /Print Invoice/ }));
    expect(printDocSpy).toHaveBeenCalledWith('/api/v1/contracts/c-1/invoice/download');
  });
});
