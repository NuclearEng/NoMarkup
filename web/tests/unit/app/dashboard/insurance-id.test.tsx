// Tests for the insurance policy detail page — exercises loading, error,
// active vs expired badge rendering, file-claim toggle, and claim form display.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const policyState: {
  data: { policy: Record<string, unknown> } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: true, isError: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/insurance/abc',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'policy-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/insurance/InsuranceClaimForm', () => ({
  InsuranceClaimForm: ({ onSuccess }: { onSuccess: () => void }) =>
    createElement(
      'div',
      { 'data-testid': 'insurance-claim-form' },
      createElement('button', { type: 'button', onClick: onSuccess }, 'Done'),
    ),
}));

vi.mock('@/hooks/useInsurance', () => ({
  useInsurancePolicy: () => policyState,
}));

const { default: InsurancePolicyPage } = await import(
  '@/app/(dashboard)/insurance/[id]/page'
);

function makePolicy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'policy-1',
    policy_number: 'POL-100',
    contract_id: 'c-1',
    coverage_amount_cents: 100000,
    premium_cents: 5000,
    deductible_cents: 1000,
    effective_date: '2026-04-01T00:00:00Z',
    expiration_date: '2027-04-01T00:00:00Z',
    status: 'active',
    created_at: '2026-04-01T00:00:00Z',
    product: {
      name: 'Basic Liability',
      coverage_type: 'liability',
      description: 'Covers property damage caused during work.',
    },
    ...overrides,
  };
}

beforeEach(() => {
  policyState.data = undefined;
  policyState.isLoading = true;
  policyState.isError = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InsurancePolicyPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(container).toBeTruthy();
  });

  it('renders error state when fetch fails', () => {
    policyState.isLoading = false;
    policyState.isError = true;
    render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(screen.getByText(/Failed to load policy/i)).toBeDefined();
  });

  it('renders error state when no data', () => {
    policyState.isLoading = false;
    policyState.data = undefined;
    render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(screen.getByText(/Failed to load policy/i)).toBeDefined();
  });

  it('renders policy header and product name when data loaded', () => {
    policyState.isLoading = false;
    policyState.data = { policy: makePolicy() };
    render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(screen.getByRole('heading', { name: 'POL-100' })).toBeDefined();
    expect(screen.getByText('Basic Liability')).toBeDefined();
  });

  it('shows Active badge for active policies', () => {
    policyState.isLoading = false;
    policyState.data = { policy: makePolicy({ status: 'active' }) };
    render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('shows Expired badge and hides File Claim button when expired', () => {
    policyState.isLoading = false;
    policyState.data = { policy: makePolicy({ status: 'expired' }) };
    render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(screen.getByText('Expired')).toBeDefined();
    expect(screen.queryByRole('button', { name: /File a Claim/i })).toBeNull();
  });

  it('shows File a Claim button for active policies', () => {
    policyState.isLoading = false;
    policyState.data = { policy: makePolicy({ status: 'active' }) };
    render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(screen.getByRole('button', { name: /File a Claim/i })).toBeDefined();
  });

  it('opens claim form when File a Claim button clicked', () => {
    policyState.isLoading = false;
    policyState.data = { policy: makePolicy({ status: 'active' }) };
    render(withQueryClient(createElement(InsurancePolicyPage)));
    fireEvent.click(screen.getByRole('button', { name: /File a Claim/i }));
    expect(screen.getByTestId('insurance-claim-form')).toBeDefined();
  });

  it('hides claim form on form success callback', () => {
    policyState.isLoading = false;
    policyState.data = { policy: makePolicy({ status: 'active' }) };
    render(withQueryClient(createElement(InsurancePolicyPage)));
    fireEvent.click(screen.getByRole('button', { name: /File a Claim/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('insurance-claim-form')).toBeNull();
  });

  it('renders coverage details and product description', () => {
    policyState.isLoading = false;
    policyState.data = { policy: makePolicy() };
    render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(screen.getByText('Coverage Amount')).toBeDefined();
    expect(screen.getByText(/Covers property damage/i)).toBeDefined();
  });

  it('renders Cancelled status correctly', () => {
    policyState.isLoading = false;
    policyState.data = { policy: makePolicy({ status: 'cancelled' }) };
    render(withQueryClient(createElement(InsurancePolicyPage)));
    expect(screen.getByText('Cancelled')).toBeDefined();
  });
});
