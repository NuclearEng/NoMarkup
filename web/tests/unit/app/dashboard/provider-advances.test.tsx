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

vi.mock('@/hooks/useContracts', () => ({
  useContracts: vi.fn(),
}));

vi.mock('@/hooks/useWorkingCapital', () => ({
  useCreditLimit: vi.fn(),
  useMyAdvances: vi.fn(),
  useRequestAdvance: vi.fn(),
}));

const { useContracts } = await import('@/hooks/useContracts');
const { useCreditLimit, useMyAdvances, useRequestAdvance } = await import(
  '@/hooks/useWorkingCapital'
);
const { default: ProviderAdvancesPage } = await import(
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
});
