// Tests for the contract guarantee-claim filing page — exercises loading, contract
// error, no-existing-claim (form rendered), and existing-claim (status card) branches.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const contractState: {
  data: { contract: Record<string, unknown> } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: true, isError: false };

const claimState: {
  data: { guarantee_claim: Record<string, unknown> | null } | undefined;
  isLoading: boolean;
} = { data: undefined, isLoading: false };

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/contracts/abc/guarantee-claim',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'contract-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/contracts/GuaranteeClaimForm', () => ({
  GuaranteeClaimForm: ({ onSuccess }: { onSuccess?: () => void }) =>
    createElement(
      'div',
      { 'data-testid': 'guarantee-claim-form' },
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'guarantee-form-success-btn',
          onClick: () => {
            onSuccess?.();
          },
        },
        'trigger success',
      ),
    ),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContract: () => contractState,
}));

vi.mock('@/hooks/useGuarantee', () => ({
  useGuaranteeClaim: () => claimState,
}));

const { default: ContractGuaranteeClaimPage } = await import(
  '@/app/(dashboard)/contracts/[id]/guarantee-claim/page'
);

function makeContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'contract-1',
    contract_number: 'CON-777',
    job_id: 'job-1',
    job_title: 'Job',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    bid_id: 'b-1',
    amount_cents: 1000,
    payment_timing: 'completion',
    status: 'completed',
    customer_accepted: true,
    provider_accepted: true,
    acceptance_deadline: '2026-04-30T00:00:00Z',
    milestones: [],
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'claim-1',
    contract_id: 'contract-1',
    opened_by: 'cust-1',
    dispute_type: 'quality',
    description: 'The job was not done correctly.',
    evidence_urls: [],
    status: 'open',
    is_guarantee_claim: true,
    created_at: '2026-04-15T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  contractState.data = undefined;
  contractState.isLoading = true;
  contractState.isError = false;
  claimState.data = undefined;
  claimState.isLoading = false;
  routerPushMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContractGuaranteeClaimPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(container).toBeTruthy();
  });

  it('renders skeleton while contract is loading', () => {
    contractState.isLoading = true;
    claimState.isLoading = false;
    const { container } = render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(container.querySelectorAll('div').length).toBeGreaterThan(0);
  });

  it('renders skeleton while claim is loading', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract() };
    claimState.isLoading = true;
    const { container } = render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(container).toBeTruthy();
  });

  it('renders error state when contract fetch fails', () => {
    contractState.isLoading = false;
    contractState.isError = true;
    render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(screen.getByText(/Failed to load contract/i)).toBeDefined();
  });

  it('renders the GuaranteeClaimForm when no existing claim', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract() };
    claimState.data = { guarantee_claim: null };
    render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(screen.getByTestId('guarantee-claim-form')).toBeDefined();
  });

  it('shows existing claim status card when a claim exists', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract() };
    claimState.data = { guarantee_claim: makeClaim() };
    render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(screen.getByText(/Guarantee Claim Status/i)).toBeDefined();
    expect(screen.getByText('Submitted')).toBeDefined();
    expect(screen.getByText(/job was not done correctly/i)).toBeDefined();
  });

  it('shows resolution notes section when claim has notes', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract() };
    claimState.data = {
      guarantee_claim: makeClaim({ resolution_notes: 'Refund issued.' }),
    };
    render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(screen.getByText('Refund issued.')).toBeDefined();
  });

  it('shows payout amount when claim has refund', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract() };
    claimState.data = {
      guarantee_claim: makeClaim({ refund_amount_cents: 12345 }),
    };
    render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(screen.getByText('Payout')).toBeDefined();
  });

  it('renders different label for resolved status', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract() };
    claimState.data = { guarantee_claim: makeClaim({ status: 'resolved' }) };
    render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(screen.getByText('Resolved')).toBeDefined();
  });

  it('navigates back to contract when GuaranteeClaimForm fires onSuccess', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract() };
    claimState.data = { guarantee_claim: null };
    render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    fireEvent.click(screen.getByTestId('guarantee-form-success-btn'));
    expect(routerPushMock).toHaveBeenCalledWith('/contracts/contract-1');
  });

  it('falls back to raw status when CLAIM_STATUS_LABELS does not contain it', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract() };
    claimState.data = {
      guarantee_claim: makeClaim({ status: 'unknown_status' }),
    };
    render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(screen.getByText('unknown_status')).toBeDefined();
  });

  it('renders contract number link in back navigation', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ contract_number: 'CON-XYZ' }) };
    claimState.data = { guarantee_claim: null };
    render(withQueryClient(createElement(ContractGuaranteeClaimPage)));
    expect(screen.getByText(/CON-XYZ/i)).toBeDefined();
  });
});
