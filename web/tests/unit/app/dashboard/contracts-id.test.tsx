// Tests for the contract detail page — exercises loading, error, customer/provider
// role conditional buttons, cancel-confirm flow, change orders, and review section.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
const reportNoShowMutate = vi.fn();
const reportAbandonmentMutate = vi.fn();
const reportNoShowState = { isPending: false, isError: false };
const reportAbandonmentState = { isPending: false, isError: false };

const installmentsState: { installments: unknown[] } = { installments: [] };
const contractPlanState: { plan: unknown; hasPlan: boolean; isLoading: boolean } = {
  plan: undefined,
  hasPlan: false,
  isLoading: false,
};
// customer_bnpl flag — default ON; toggled per-case. Other flags fail open.
const flagState: Record<string, boolean> = { customer_bnpl: true };
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

vi.mock('@/components/contracts/RecurringSchedule', () => ({
  RecurringSchedule: () => createElement('div', { 'data-testid': 'recurring-schedule' }),
}));

vi.mock('@/components/payments/InstallmentSchedule', () => ({
  InstallmentSchedule: () => createElement('div', { 'data-testid': 'installment-schedule' }),
}));

vi.mock('@/components/payments/InstallmentPlanSelector', () => ({
  InstallmentPlanSelector: () =>
    createElement('div', { 'data-testid': 'installment-plan-selector' }),
}));

vi.mock('@/components/ui/ShareSavingsCard', () => ({
  ShareSavingsCard: () => createElement('div', { 'data-testid': 'share-savings' }),
}));

vi.mock('@/hooks/useContracts', () => ({
  useAcceptanceExpired: (status: string, deadline: string | null | undefined) =>
    status === 'pending_acceptance' && !!deadline && new Date(deadline).getTime() < Date.now(),
  useContract: () => contractState,
  useStartWork: () => ({ mutate: startWorkMutate, ...startWorkState }),
  useMarkComplete: () => ({ mutate: markCompleteMutate, ...markCompleteState }),
  useApproveCompletion: () => ({ mutate: approveCompletionMutate, ...approveCompletionState }),
  useCancelContract: () => ({ mutate: cancelContractMutate, ...cancelContractState }),
  useReportNoShow: () => ({ mutate: reportNoShowMutate, ...reportNoShowState }),
  useReportAbandonment: () => ({ mutate: reportAbandonmentMutate, ...reportAbandonmentState }),
  usePartyJobLocation: () => ({ data: '123 Main St, Springfield, IL 62701' }),
  useProposeChangeOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useRespondToChangeOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useBids', () => ({
  useSavings: () => savingsState,
}));

vi.mock('@/hooks/useInstallments', () => ({
  useInstallmentSchedule: () => installmentsState,
  useContractInstallmentPlan: () => contractPlanState,
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: (key: string) => flagState[key] ?? true,
  useFeatureFlags: () => flagState,
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

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

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
  contractPlanState.plan = undefined;
  contractPlanState.hasPlan = false;
  contractPlanState.isLoading = false;
  flagState.customer_bnpl = true;
  savingsState.data = undefined;
  reviewEligibilityState.data = undefined;
  reviewEligibilityState.isLoading = false;
  authUser.user = { id: 'cust-1' };
  startWorkMutate.mockReset();
  markCompleteMutate.mockReset();
  approveCompletionMutate.mockReset();
  cancelContractMutate.mockReset();
  reportNoShowMutate.mockReset();
  reportAbandonmentMutate.mockReset();
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

  it('renders the BNPL selector for an active contract as the customer with the flag on and no plan', () => {
    authUser.user = { id: 'cust-1' };
    flagState.customer_bnpl = true;
    contractPlanState.hasPlan = false;
    installmentsState.installments = [];
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByTestId('installment-plan-selector')).toBeDefined();
  });

  it('hides the BNPL selector when the customer_bnpl flag is OFF', () => {
    authUser.user = { id: 'cust-1' };
    flagState.customer_bnpl = false;
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.queryByTestId('installment-plan-selector')).toBeNull();
  });

  it('hides the BNPL selector and shows the schedule once a plan exists', () => {
    authUser.user = { id: 'cust-1' };
    flagState.customer_bnpl = true;
    contractPlanState.hasPlan = true;
    installmentsState.installments = [{ id: 'inst-1' }];
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.queryByTestId('installment-plan-selector')).toBeNull();
    expect(screen.getByTestId('installment-schedule')).toBeDefined();
  });

  it('hides the BNPL selector from the provider', () => {
    authUser.user = { id: 'prov-1' };
    flagState.customer_bnpl = true;
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.queryByTestId('installment-plan-selector')).toBeNull();
  });

  it('shows the start-work error message when the start-work mutation fails', () => {
    authUser.user = { id: 'prov-1' };
    startWorkState.isError = true;
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText(/Failed to start work/i)).toBeDefined();
  });

  it('shows the approve-completion error message when that mutation fails', () => {
    authUser.user = { id: 'cust-1' };
    approveCompletionState.isError = true;
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText(/Failed to approve completion/i)).toBeDefined();
  });

  it('renders the cancel error message after a failed cancel mutation', () => {
    cancelContractState.isError = true;
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel Contract$/i }));
    expect(screen.getByText(/Failed to cancel contract/i)).toBeDefined();
  });

  it('renders the Auction Replay card and Watch Replay link for completed contracts', () => {
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({
        status: 'completed',
        completed_at: '2026-04-15T00:00:00Z',
        accepted_at: '2026-04-01T00:00:00Z',
        started_at: '2026-04-02T00:00:00Z',
      }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText('Auction Replay')).toBeDefined();
    expect(screen.getByRole('link', { name: /Watch Replay/i })).toBeDefined();
  });

  it('renders the ShareSavingsCard for completed contracts where the customer saved money', () => {
    authUser.user = { id: 'cust-1' };
    savingsState.data = [{ job_id: 'jobid12345678', savings_cents: 25000 }];
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'completed', completed_at: '2026-04-15T00:00:00Z' }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByTestId('share-savings')).toBeDefined();
  });

  it('renders the ReviewSection loading state for completed contracts when eligibility is loading', () => {
    authUser.user = { id: 'cust-1' };
    reviewEligibilityState.isLoading = true;
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'completed', completed_at: '2026-04-15T00:00:00Z' }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByLabelText(/Loading reviews/i)).toBeDefined();
  });

  it('renders Leave a Review CTA when the contract is eligible and not yet reviewed', () => {
    authUser.user = { id: 'cust-1' };
    reviewEligibilityState.data = {
      eligible: true,
      already_reviewed: false,
      review_window_closes_at: '2026-05-15T00:00:00Z',
    };
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'completed', completed_at: '2026-04-15T00:00:00Z' }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByRole('link', { name: /Leave a Review/i })).toBeDefined();
  });

  it('renders the already-reviewed banner in the ReviewSection', () => {
    authUser.user = { id: 'cust-1' };
    reviewEligibilityState.data = {
      eligible: true,
      already_reviewed: true,
      review_window_closes_at: '2026-05-15T00:00:00Z',
    };
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'completed', completed_at: '2026-04-15T00:00:00Z' }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText(/already reviewed this contract/i)).toBeDefined();
  });

  it('renders the closed review-window message when not eligible and not reviewed', () => {
    authUser.user = { id: 'cust-1' };
    reviewEligibilityState.data = {
      eligible: false,
      already_reviewed: false,
      review_window_closes_at: '2026-04-10T00:00:00Z',
    };
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'completed', completed_at: '2026-04-15T00:00:00Z' }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText(/review window for this contract has closed/i)).toBeDefined();
  });

  it('renders the accepted_at and started_at rows when those timestamps are present', () => {
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({
        status: 'active',
        accepted_at: '2026-04-02T00:00:00Z',
        started_at: '2026-04-03T00:00:00Z',
      }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText('Accepted')).toBeDefined();
    expect(screen.getByText('Started')).toBeDefined();
  });

  it('renders all change-order status badge variants (accepted, rejected, expired)', () => {
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'active' }),
      change_orders: [
        {
          id: 'co-acc',
          description: 'Accepted change',
          status: 'accepted',
          proposed_by: 'prov-1234',
          amount_delta_cents: 1000,
          created_at: '2026-04-04T00:00:00Z',
        },
        {
          id: 'co-rej',
          description: 'Rejected change',
          status: 'rejected',
          proposed_by: 'prov-1234',
          amount_delta_cents: -500,
          created_at: '2026-04-04T00:00:00Z',
        },
        {
          id: 'co-exp',
          description: 'Expired change',
          status: 'expired',
          proposed_by: 'prov-1234',
          amount_delta_cents: 0,
          created_at: '2026-04-04T00:00:00Z',
        },
      ],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText('Accepted change')).toBeDefined();
    expect(screen.getByText('Rejected change')).toBeDefined();
    expect(screen.getByText('Expired change')).toBeDefined();
  });

  it('renders CompletionFlow when an active contract has all milestones approved', () => {
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({
        status: 'active',
        milestones: [{ status: 'approved' }, { status: 'approved' }],
      }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByTestId('completion-flow')).toBeDefined();
  });

  it('renders the spinner when startWork mutation is pending', () => {
    authUser.user = { id: 'prov-1' };
    startWorkState.isPending = true;
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    const { container } = render(withQueryClient(createElement(ContractDetailPage)));
    // Spinner appears inside the Start Work button while pending
    const startBtn = screen.getByRole('button', { name: /Start Work/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders the spinner when markComplete mutation is pending', () => {
    authUser.user = { id: 'prov-1' };
    markCompleteState.isPending = true;
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'active', started_at: '2026-04-05T00:00:00Z' }),
      change_orders: [],
    };
    const { container } = render(withQueryClient(createElement(ContractDetailPage)));
    const markBtn = screen.getByRole('button', { name: /Mark as Complete/i });
    expect((markBtn as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders the spinner when approveCompletion mutation is pending', () => {
    authUser.user = { id: 'cust-1' };
    approveCompletionState.isPending = true;
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    const { container } = render(withQueryClient(createElement(ContractDetailPage)));
    const approveBtn = screen.getByRole('button', { name: /Approve Completion/i });
    expect((approveBtn as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders the spinner inside Confirm Cancel while cancel mutation is pending', () => {
    cancelContractState.isPending = true;
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    const { container } = render(withQueryClient(createElement(ContractDetailPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel Contract$/i }));
    const confirmBtn = screen.getByRole('button', { name: /Confirm Cancel/i });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('falls back to truncated job_id when job_title is missing', () => {
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({ status: 'active', job_title: '', job_id: 'jobid12345678' }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    // Truncated to first 8 chars: 'jobid123'
    expect(screen.getByText(/jobid123/)).toBeDefined();
  });

  it('cancel onSuccess callback closes the cancel-confirm panel', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    // Make the cancelContract.mutate handler fire its onSuccess synchronously.
    cancelContractMutate.mockImplementation(
      (_id: unknown, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.();
      },
    );
    render(withQueryClient(createElement(ContractDetailPage)));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel Contract$/i }));
    expect(screen.getByText(/Are you sure you want to cancel/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Cancel/i }));
    // The onSuccess closes the confirm panel.
    expect(screen.queryByText(/Are you sure you want to cancel/i)).toBeNull();
  });

  it('shows FR-5.4 local terms award residual badge and messaging', () => {
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({
        status: 'active',
        local_terms: {
          payment_timing: 'completion',
          amount: 'Match bid total',
          bound_at: 'award',
          accepted_at: '2026-04-01T12:00:00Z',
        },
      }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText('Agreed local terms')).toBeDefined();
    expect(screen.getByText('Applied at award')).toBeDefined();
    expect(screen.getByText(/award residual bind/i)).toBeDefined();
    expect(screen.getByText('Match bid total')).toBeDefined();
  });

  it('shows honest empty-snapshot residual when local_terms has only metadata', () => {
    contractState.isLoading = false;
    contractState.data = {
      contract: makeContract({
        status: 'active',
        local_terms: {
          bound_at: 'award',
          source: 'chat_accept',
        },
      }),
      change_orders: [],
    };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.getByText(/no payment-type or notes fields/i)).toBeDefined();
  });

  it('shows Get Directions for a contract party when a service address is available', () => {
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    const link = screen.getByRole('link', { name: /Get Directions/i });
    expect(link.getAttribute('href')).toContain('123%20Main%20St');
  });

  it('shows customer no-show and abandonment reports on an active contract', () => {
    authUser.user = { id: 'cust-1' };
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    fireEvent.click(screen.getByRole('button', { name: /Report no-show/i }));
    const confirms = screen.getAllByRole('button', { name: /Report no-show/i });
    fireEvent.click(confirms[confirms.length - 1] as HTMLElement);
    expect(reportNoShowMutate).toHaveBeenCalled();
  });

  it('confirms abandonment via ActionConfirmDialog, not window.confirm', () => {
    authUser.user = { id: 'cust-1' };
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    fireEvent.click(screen.getByRole('button', { name: /Report abandonment/i }));
    expect(screen.getByText(/started work and then left/i)).toBeDefined();
    const confirms = screen.getAllByRole('button', { name: /Report abandonment/i });
    fireEvent.click(confirms[confirms.length - 1] as HTMLElement);
    expect(reportAbandonmentMutate).toHaveBeenCalled();
  });

  it('hides report CTAs from the provider', () => {
    authUser.user = { id: 'prov-1' };
    contractState.isLoading = false;
    contractState.data = { contract: makeContract({ status: 'active' }), change_orders: [] };
    render(withQueryClient(createElement(ContractDetailPage)));
    expect(screen.queryByRole('button', { name: /Report no-show/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Report abandonment/i })).toBeNull();
  });
});
