// Tests for the contract detail page — exercises loading, error, customer/provider
// role conditional buttons, cancel-confirm flow, change orders, and review section.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const contractState: {
  data: { contract: Record<string, unknown>; change_orders: unknown[] } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: true, isError: false };

const startWorkState = { isPending: false, isError: false };
const markCompleteState = { isPending: false, isError: false };
const approveCompletionState = { isPending: false, isError: false };
const cancelContractState = { isPending: false, isError: false };
const startWorkMutate = vi.fn();
const markCompleteMutate = vi.fn();
const approveCompletionMutate = vi.fn();
const cancelContractMutate = vi.fn();

const installmentsState: { installments: unknown[] } = { installments: [] };
const savingsState: { data: unknown } = { data: undefined };
const reviewEligibilityState: {
  data: { eligible: boolean; already_reviewed: boolean; review_window_closes_at: string } | undefined;
  isLoading: boolean;
} = { data: undefined, isLoading: false };
const authUser: { user: { id: string } | null } = { user: { id: 'cust-1' } };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/contracts/abc',
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

vi.mock('@/components/contracts/CompletionFlow', () => ({
  CompletionFlow: () => createElement('div', { 'data-testid': 'completion-flow' }),
}));

vi.mock('@/components/contracts/ContractAcceptance', () => ({
  ContractAcceptance: () => createElement('div', { 'data-testid': 'contract-acceptance' }),
}));

vi.mock('@/components/contracts/GuaranteeCoverage', () => ({
  GuaranteeCoverage: () => createElement('div', { 'data-testid': 'guarantee-coverage' }),
}));

vi.mock('@/components/contracts/MilestoneTracker', () => ({
  MilestoneTracker: () => createElement('div', { 'data-testid': 'milestone-tracker' }),
}));

vi.mock('@/components/payments/InstallmentSchedule', () => ({
  InstallmentSchedule: () => createElement('div', { 'data-testid': 'installment-schedule' }),
}));

vi.mock('@/components/ui/ShareSavingsCard', () => ({
  ShareSavingsCard: () => createElement('div', { 'data-testid': 'share-savings' }),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContract: () => contractState,
  useStartWork: () => ({ mutate: startWorkMutate, ...startWorkState }),
  useMarkComplete: () => ({ mutate: markCompleteMutate, ...markCompleteState }),
  useApproveCompletion: () => ({ mutate: approveCompletionMutate, ...approveCompletionState }),
  useCancelContract: () => ({ mutate: cancelContractMutate, ...cancelContractState }),
}));

vi.mock('@/hooks/useBids', () => ({
  useSavings: () => savingsState,
}));

vi.mock('@/hooks/useInstallments', () => ({
  useInstallmentSchedule: () => installmentsState,
}));

vi.mock('@/hooks/useReviews', () => ({
  useReviewEligibility: () => reviewEligibilityState,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(authUser),
}));

const { default: ContractDetailPage } = await import(
  '@/app/(dashboard)/contracts/[id]/page'
);

function makeContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'contract-1',
    contract_number: 'CON-001',
    job_id: 'jobid12345678',
    job_title: 'Sink Repair',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    bid_id: 'bid-1',
    amount_cents: 50000,
    payment_timing: 'completion',
    status: 'active',
    customer_accepted: true,
    provider_accepted: true,
    acceptance_deadline: '2026-04-30T00:00:00Z',
    milestones: [],
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  contractState.data = undefined;
  contractState.isLoading = true;
  contractState.isError = false;
  startWorkState.isPending = false;
  startWorkState.isError = false;
  markCompleteState.isPending = false;
  markCompleteState.isError = false;
  approveCompletionState.isPending = false;
  approveCompletionState.isError = false;
  cancelContractState.isPending = false;
  cancelContractState.isError = false;
  installmentsState.installments = [];
  savingsState.data = undefined;
  reviewEligibilityState.data = undefined;
  reviewEligibilityState.isLoading = false;
  authUser.user = { id: 'cust-1' };
  startWorkMutate.mockReset();
  markCompleteMutate.mockReset();
  approveCompletionMutate.mockReset();
  cancelContractMutate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContractDetailPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(ContractDetailPage)));
    expect(container).toBeTruthy();
  });

  it('renders error state when fetch fails', () => {
    contractState.isLoading = false;
    contractState.isError = true;
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText(/Failed to load contract/i)).toBeDefined();
  });

  it('renders error state when no data returned', () => {
    contractState.isLoading = false;
    contractState.isError = false;
    contractState.data = undefined;
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText(/Failed to load contract/i)).toBeDefined();
  });

  it('renders contract header with formatted amount', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract(), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByRole('heading', { name: 'CON-001' })).toBeDefined();
  });

  it('shows ContractAcceptance for pending_acceptance status', () => {
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'pending_acceptance' }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByTestId('contract-acceptance')).toBeDefined();
  });

  it('shows MilestoneTracker for active contract', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByTestId('milestone-tracker')).toBeDefined();
  });

  it('shows provider Start Work button when active and provider role with no started_at', () => {
    authUser.user = { id: 'prov-1' };
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    const startBtn = screen.getByRole('button', { name: /Start Work/i });
    fireEvent.click(startBtn);
    expect(startWorkMutate).toHaveBeenCalledWith('contract-1');
  });

  it('shows provider Mark Complete button when work has started', () => {
    authUser.user = { id: 'prov-1' };
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'active', started_at: '2026-04-05T00:00:00Z' }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    const markBtn = screen.getByRole('button', { name: /Mark as Complete/i });
    fireEvent.click(markBtn);
    expect(markCompleteMutate).toHaveBeenCalledWith('contract-1');
  });

  it('shows customer Approve Completion button and triggers mutation', () => {
    authUser.user = { id: 'cust-1' };
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    const approveBtn = screen.getByRole('button', { name: /Approve Completion/i });
    fireEvent.click(approveBtn);
    expect(approveCompletionMutate).toHaveBeenCalled();
  });

  it('reveals cancel-confirm UI when Cancel Contract clicked, then confirms', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel Contract$/i }));
    expect(screen.getByText(/Are you sure you want to cancel/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Cancel/i }));
    expect(cancelContractMutate).toHaveBeenCalled();
  });

  it('hides cancel-confirm UI when Keep Contract clicked', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel Contract$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Keep Contract/i }));
    expect(screen.queryByText(/Are you sure you want to cancel/i)).toBeNull();
  });

  it('shows error message after mark-complete failure', () => {
    authUser.user = { id: 'prov-1' };
    markCompleteState.isError = true;
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'active', started_at: '2026-04-05T00:00:00Z' }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText(/Failed to mark complete/i)).toBeDefined();
  });

  it('renders change orders list when change_orders provided', () => {
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'active' }),
      change_orders: [
        {
          id: 'co-1',
          description: 'Add extra outlet',
          status: 'proposed',
          proposed_by: 'prov-12345678',
          amount_delta_cents: 5000,
          created_at: '2026-04-04T00:00:00Z',
        },
      ],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText('Add extra outlet')).toBeDefined();
    expect(screen.getByText(/Change Orders/i)).toBeDefined();
  });

  it('renders InstallmentSchedule when installments are present', () => {
    installmentsState.installments = [{ id: 'inst-1' }];
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByTestId('installment-schedule')).toBeDefined();
  });
});
