// Contract detail page — flows the base spec leaves out: printable documents
// (contract + invoice), the provider change-order form and its cents payload,
// customer approve/reject of a change order, the report confirm round trips,
// local-terms variants, tipping state, and what a non-party viewer may see.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

interface ChangeOrderInput {
  contractId: string;
  description: string;
  amount_delta_cents: number;
}
interface Callbacks {
  onSuccess?: () => void;
}

const h = vi.hoisted(() => ({
  contract: {
    data: undefined as
      | { contract: Record<string, unknown>; change_orders: Record<string, unknown>[] }
      | undefined,
    isLoading: false,
    isError: false,
  },
  user: { id: 'cust-1' } as { id: string } | null,
  eligibility: {
    data: undefined as
      | { eligible: boolean; already_reviewed: boolean; review_window_closes_at?: string }
      | undefined,
    isLoading: false,
    isError: false,
  },
  directions: '123 Main St, Springfield, IL 62701' as string | undefined,
  flags: {} as Record<string, boolean>,
  propose: {
    mutate: vi.fn<(input: ChangeOrderInput, callbacks?: Callbacks) => void>(),
    isPending: false,
  },
  respond: {
    mutate:
      vi.fn<(input: { contractId: string; changeOrderId: string; accepted: boolean }) => void>(),
    isPending: false,
  },
  noShow: { mutate: vi.fn<(id: string, callbacks?: Callbacks) => void>(), isPending: false },
  abandonment: {
    mutate: vi.fn<(id: string, callbacks?: Callbacks) => void>(),
    isPending: false,
  },
  post: vi.fn<(path: string) => Promise<unknown>>(),
  print: vi.fn<(path: string) => Promise<void>>(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'contract-1' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

function stub(testId: string) {
  return () => createElement('div', { 'data-testid': testId });
}

vi.mock('@/components/contracts/CompletionFlow', () => ({
  CompletionFlow: stub('completion-flow'),
}));
vi.mock('@/components/contracts/ContractAcceptance', () => ({
  ContractAcceptance: stub('contract-acceptance'),
}));
vi.mock('@/components/contracts/ContractOneShotPay', () => ({
  ContractOneShotPay: stub('contract-one-shot-pay'),
}));
vi.mock('@/components/contracts/GuaranteeCoverage', () => ({
  GuaranteeCoverage: stub('guarantee-coverage'),
}));
vi.mock('@/components/contracts/MilestoneTracker', () => ({
  MilestoneTracker: stub('milestone-tracker'),
}));
vi.mock('@/components/contracts/RecurringSchedule', () => ({
  RecurringSchedule: (props: { isCustomer: boolean; isProvider: boolean; jobId?: string }) =>
    createElement(
      'div',
      { 'data-testid': 'recurring-schedule' },
      `${String(props.isCustomer)}|${String(props.isProvider)}|${props.jobId ?? ''}`,
    ),
}));
vi.mock('@/components/contracts/WorkEvidencePack', () => ({
  WorkEvidencePack: stub('work-evidence-pack'),
}));
vi.mock('@/components/payments/InstallmentSchedule', () => ({
  InstallmentSchedule: stub('installment-schedule'),
}));
vi.mock('@/components/payments/InstallmentPlanSelector', () => ({
  InstallmentPlanSelector: stub('installment-plan-selector'),
}));
vi.mock('@/components/insurance/InsuranceSelector', () => ({
  InsuranceSelector: stub('insurance-selector'),
}));
vi.mock('@/components/maps/DirectionsButton', () => ({
  DirectionsButton: ({ address }: { address: string }) =>
    createElement('div', { 'data-testid': 'directions' }, address),
}));
vi.mock('@/components/ui/ShareSavingsCard', () => ({
  ShareSavingsCard: stub('share-savings'),
}));

vi.mock('@/hooks/useContracts', () => ({
  useAcceptanceExpired: () => false,
  useContract: () => h.contract,
  useStartWork: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useMarkComplete: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useApproveCompletion: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCancelContract: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useReportNoShow: () => h.noShow,
  useReportAbandonment: () => h.abandonment,
  usePartyJobLocation: () => ({ data: h.directions }),
  useProposeChangeOrder: () => h.propose,
  useRespondToChangeOrder: () => h.respond,
}));

vi.mock('@/hooks/useBids', () => ({
  useSavings: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useInstallments', () => ({
  useInstallmentSchedule: () => ({ installments: [] }),
  useContractInstallmentPlan: () => ({ plan: undefined, hasPlan: false, isLoading: false }),
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: (key: string) => h.flags[key] ?? true,
}));

vi.mock('@/hooks/useReviews', () => ({
  useReviewEligibility: () => h.eligibility,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: h.user }),
}));

vi.mock('@/lib/api', () => ({
  api: { post: h.post },
  ApiError: class ApiError extends Error {},
  clearIdempotencyKey: vi.fn(),
  idempotencyHeader: () => ({ 'Idempotency-Key': 'test-key' }),
  getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('@/lib/print', () => ({
  printAuthenticatedDocument: h.print,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const { default: ContractDetailPage } = await import('@/app/(dashboard)/contracts/[id]/page');

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

function makeChangeOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'co-1',
    contract_id: 'contract-1',
    proposed_by: 'prov-1-abcdef',
    description: 'Replace the P-trap as well',
    amount_delta_cents: 25000,
    status: 'proposed',
    created_at: '2026-04-05T15:00:00Z',
    ...overrides,
  };
}

function show(
  contract: Record<string, unknown> = makeContract(),
  changeOrders: Record<string, unknown>[] = [],
) {
  h.contract.data = { contract, change_orders: changeOrders };
  return render(withQueryClient(createElement(ContractDetailPage)));
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve: () => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function confirmDialog(title: string): HTMLElement {
  const el = screen.getByText(title).closest('dialog');
  if (!el) throw new Error(`expected a dialog titled ${title}`);
  return el;
}

beforeEach(() => {
  h.contract.data = undefined;
  h.contract.isLoading = false;
  h.contract.isError = false;
  h.user = { id: 'cust-1' };
  h.eligibility.data = undefined;
  h.eligibility.isLoading = false;
  h.eligibility.isError = false;
  h.directions = '123 Main St, Springfield, IL 62701';
  h.flags = {};
  for (const m of [h.propose, h.respond, h.noShow, h.abandonment]) {
    m.mutate.mockReset();
    m.isPending = false;
  }
  h.post.mockReset();
  h.post.mockResolvedValue({ invoice_url: '/x' });
  h.print.mockReset();
  h.print.mockResolvedValue(undefined);
});

describe('ContractDetailPage — documents', () => {
  it('prints the contract document and locks both buttons while it loads', async () => {
    const pending = deferred();
    h.print.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: 'Contract document' }));

    expect(h.print).toHaveBeenCalledWith('/api/v1/contracts/contract-1/document.pdf');
    expect(screen.getByRole('button', { name: 'Contract document' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Invoice' })).toBeDisabled();

    pending.resolve();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Contract document' })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: 'Invoice' })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    // The document path never creates an invoice.
    expect(h.post).not.toHaveBeenCalled();
  });

  it('reports a failed contract document and lets the user try again', async () => {
    h.print.mockRejectedValueOnce(new Error('Failed to load document (500)'));
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: 'Contract document' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to open contract document. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Contract document' })).toBeEnabled();

    // A retry clears the stale error.
    await user.click(screen.getByRole('button', { name: 'Contract document' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(h.print).toHaveBeenCalledTimes(2);
  });

  it('creates the invoice first, then prints the download', async () => {
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: 'Invoice' }));

    await waitFor(() => {
      expect(h.print).toHaveBeenCalledWith('/api/v1/contracts/contract-1/invoice/download');
    });
    expect(h.post).toHaveBeenCalledWith('/api/v1/contracts/contract-1/invoice');
    const postOrder = h.post.mock.invocationCallOrder[0] ?? 0;
    const printOrder = h.print.mock.invocationCallOrder[0] ?? 0;
    expect(postOrder).toBeLessThan(printOrder);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still prints when the invoice already exists (create rejected)', async () => {
    h.post.mockRejectedValue(new Error('conflict'));
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: 'Invoice' }));

    await waitFor(() => {
      expect(h.print).toHaveBeenCalledWith('/api/v1/contracts/contract-1/invoice/download');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains that an invoice may need a completed payment when the download fails', async () => {
    h.print.mockRejectedValue(new Error('Failed to load document (404)'));
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: 'Invoice' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to open invoice. It may require a completed payment first.',
    );
    expect(screen.getByRole('button', { name: 'Invoice' })).toBeEnabled();
  });

  it('offers documents to the provider but not to someone outside the contract', () => {
    h.user = { id: 'prov-1' };
    const { unmount } = show();
    expect(screen.getByRole('button', { name: 'Contract document' })).toBeInTheDocument();
    unmount();

    h.user = { id: 'stranger' };
    show();
    expect(screen.queryByRole('button', { name: 'Contract document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invoice' })).toBeNull();
  });
});

describe('ContractDetailPage — non-party viewer', () => {
  it('sees the contract but none of the party-only surfaces', () => {
    h.user = { id: 'stranger' };
    show();

    expect(screen.getByText('CON-001')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.queryByText(/\(You\)/)).toBeNull();
    expect(screen.queryByTestId('directions')).toBeNull();
    expect(screen.queryByTestId('work-evidence-pack')).toBeNull();
    expect(screen.queryByTestId('recurring-schedule')).toBeNull();
    expect(screen.queryByTestId('contract-one-shot-pay')).toBeNull();
    expect(screen.queryByTestId('insurance-selector')).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
    expect(screen.queryByText('Reports')).toBeNull();
    expect(screen.queryByText('Change Orders')).toBeNull();
  });

  it('gets no review prompt on a completed contract', () => {
    h.user = { id: 'stranger' };
    h.eligibility.data = { eligible: true, already_reviewed: false };
    show(makeContract({ status: 'completed' }));
    expect(screen.queryByText('Reviews')).toBeNull();
    expect(screen.queryByText('Tip your provider')).toBeNull();
  });

  it('a signed-out viewer is treated as a non-party', () => {
    h.user = null;
    show();
    expect(screen.queryByText('Actions')).toBeNull();
    expect(screen.queryByTestId('recurring-schedule')).toBeNull();
  });
});

describe('ContractDetailPage — header and parties', () => {
  it('marks the viewer’s own side and prefers enriched names', () => {
    show(makeContract({ customer_name: 'Casey Customer', provider_name: 'Pat Provider' }));
    expect(screen.getByText('Casey Customer (You)')).toBeInTheDocument();
    expect(screen.getByText('Pat Provider')).toBeInTheDocument();
  });

  it('falls back to a truncated id when a party name is missing', () => {
    h.user = { id: 'provider-0123456789' };
    show(makeContract({ customer_id: 'customer-abcdefgh', provider_id: 'provider-0123456789' }));
    expect(screen.getByText('customer...')).toBeInTheDocument();
    expect(screen.getByText('provider... (You)')).toBeInTheDocument();
  });

  it('hides directions when the party has no service address', () => {
    h.directions = undefined;
    show();
    expect(screen.queryByTestId('directions')).toBeNull();
  });

  it('passes the viewer role and job through to the recurring schedule', () => {
    h.user = { id: 'prov-1' };
    show();
    expect(screen.getByTestId('recurring-schedule')).toHaveTextContent(
      'false|true|jobid12345678',
    );
  });

  it('prints the completed date in the details card', () => {
    const { unmount } = show(makeContract({ status: 'completed' }));
    // Status badge only — no Completed row without a timestamp.
    expect(screen.getAllByText('Completed')).toHaveLength(1);
    unmount();

    show(makeContract({ status: 'completed', completed_at: '2026-04-20T12:00:00Z' }));
    expect(screen.getAllByText('Completed')).toHaveLength(2);
    expect(screen.getByText('Apr 20, 2026')).toBeInTheDocument();
  });

  it('hides the insurance-quotes link when the competition flag is off', () => {
    h.flags = { insurance_competition: false };
    const { unmount } = show();
    expect(screen.queryByText('Compare Insurance Quotes')).toBeNull();
    unmount();

    h.flags = {};
    show();
    const link = screen.getByText('Compare Insurance Quotes').closest('a');
    expect(link).toHaveAttribute(
      'href',
      '/insurance/quotes?contractId=contract-1&coverageCents=50000',
    );
  });
});

describe('ContractDetailPage — agreed local terms', () => {
  it('describes chat-accepted terms without the award badge', () => {
    show(
      makeContract({
        local_terms: {
          payment_type: 'milestone',
          milestones: 'Rough-in\nFinal fit',
          description: 'Customer supplies fixtures',
          bound_at: 'chat',
        },
      }),
    );

    expect(screen.getByText('Payment terms accepted in chat.')).toBeInTheDocument();
    expect(screen.queryByText('Applied at award')).toBeNull();
    // payment_type is the fallback when payment_timing is absent.
    const typeRow = screen.getByText('Payment type').parentElement;
    expect(typeRow).toHaveTextContent('Milestone');
    expect(screen.getByText('Customer supplies fixtures')).toBeInTheDocument();
    expect(screen.getByText(/Rough-in/)).toHaveTextContent('Rough-in Final fit');
    expect(screen.queryByText('Amount notes')).toBeNull();
    expect(screen.queryByText('Accepted at')).toBeNull();
    expect(screen.queryByText(/no payment-type or notes fields/i)).toBeNull();
  });

  it('prefers payment_timing over payment_type and humanises unknown values', () => {
    show(
      makeContract({
        local_terms: { payment_timing: 'net_30_days', payment_type: 'upfront' },
      }),
    );
    const typeRow = screen.getByText('Payment type').parentElement;
    expect(typeRow).toHaveTextContent('net 30 days');
    expect(typeRow).not.toHaveTextContent('Upfront');
  });

  it('omits the card when no terms were ever bound', () => {
    const { unmount } = show(makeContract({ local_terms: {} }));
    expect(screen.queryByText('Agreed local terms')).toBeNull();
    unmount();
    show(makeContract({ local_terms: null }));
    expect(screen.queryByText('Agreed local terms')).toBeNull();
  });
});

describe('ContractDetailPage — provider change orders', () => {
  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Propose Change Order' }));
    return {
      description: screen.getByLabelText('Description'),
      amount: screen.getByLabelText('Amount change (USD)'),
      submit: screen.getByRole('button', { name: 'Submit Change Order' }),
    };
  }

  beforeEach(() => {
    h.user = { id: 'prov-1' };
  });

  it('lets the provider open and cancel the form even with no change orders yet', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.getByText('Change Orders')).toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Propose Change Order' }));
    expect(screen.getByLabelText('Description')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Description')).toBeNull();
    expect(h.propose.mutate).not.toHaveBeenCalled();
  });

  it('keeps Submit disabled until there is a description and a non-zero amount', async () => {
    const user = userEvent.setup();
    show();
    const form = await openForm(user);
    expect(form.submit).toBeDisabled();

    await user.type(form.amount, '250');
    expect(form.submit).toBeDisabled();

    await user.type(form.description, '   ');
    expect(form.submit).toBeDisabled();

    await user.type(form.description, 'Extra valve');
    expect(form.submit).toBeEnabled();

    await user.clear(form.amount);
    await user.type(form.amount, '0');
    expect(form.submit).toBeDisabled();

    await user.clear(form.amount);
    await user.type(form.amount, '0.00');
    expect(form.submit).toBeDisabled();
  });

  it('submits an increase as integer cents with a trimmed description, then resets', async () => {
    const user = userEvent.setup();
    show();
    const form = await openForm(user);
    await user.type(form.description, '  Add a shut-off valve  ');
    await user.type(form.amount, '250.55');
    await user.click(form.submit);

    expect(h.propose.mutate).toHaveBeenCalledTimes(1);
    expect(h.propose.mutate.mock.calls[0]?.[0]).toEqual({
      contractId: 'contract-1',
      description: 'Add a shut-off valve',
      amount_delta_cents: 25055,
    });
    // The form stays up until the server accepts the proposal.
    expect(screen.getByLabelText('Description')).toHaveValue('  Add a shut-off valve  ');

    h.propose.mutate.mock.calls[0]?.[1]?.onSuccess?.();
    await waitFor(() => {
      expect(screen.queryByLabelText('Description')).toBeNull();
    });

    // Reopening shows a blank form.
    const reopened = await openForm(user);
    expect(reopened.description).toHaveValue('');
    expect(reopened.amount).toHaveValue(null);
  });

  it('submits a reduction as negative cents', async () => {
    const user = userEvent.setup();
    show();
    const form = await openForm(user);
    await user.type(form.description, 'Customer supplied the faucet');
    await user.type(form.amount, '-100');
    await user.click(form.submit);

    expect(h.propose.mutate.mock.calls[0]?.[0]).toMatchObject({ amount_delta_cents: -10000 });
  });

  it('rounds a floating-point amount to the nearest cent', async () => {
    const user = userEvent.setup();
    show();
    const form = await openForm(user);
    await user.type(form.description, 'Small parts');
    // 19.99 * 100 === 1998.9999999999998 in IEEE-754.
    await user.type(form.amount, '19.99');
    await user.click(form.submit);

    expect(h.propose.mutate.mock.calls[0]?.[0]).toMatchObject({ amount_delta_cents: 1999 });
  });

  it('replaces the Submit label with a spinner and blocks resubmits while proposing', async () => {
    h.propose.isPending = true;
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Propose Change Order' }));
    await user.type(screen.getByLabelText('Description'), 'Extra valve');
    await user.type(screen.getByLabelText('Amount change (USD)'), '50');

    expect(screen.queryByRole('button', { name: 'Submit Change Order' })).toBeNull();
    const buttons = screen.getAllByRole('button').filter((b) => b.textContent === '');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeDisabled();
  });

  it('cannot propose on a contract that is not active', () => {
    show(makeContract({ status: 'completed' }), [makeChangeOrder({ status: 'accepted' })]);
    expect(screen.getByText('Change Orders')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose Change Order' })).toBeNull();
  });

  it('does not offer the provider approve/reject on their own proposal', () => {
    show(makeContract(), [makeChangeOrder()]);
    expect(screen.getByText('Replace the P-trap as well')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });
});

describe('ContractDetailPage — customer change-order response', () => {
  it('shows signed amounts, the proposer, the date and the status', () => {
    show(makeContract(), [
      makeChangeOrder(),
      makeChangeOrder({
        id: 'co-2',
        description: 'Skip the disposal',
        amount_delta_cents: -10000,
        status: 'rejected',
      }),
    ]);

    expect(screen.getByText('+$250.00')).toBeInTheDocument();
    expect(screen.getByText('-$100.00')).toBeInTheDocument();
    expect(screen.getAllByText('Proposed by: prov-1-a...')).toHaveLength(2);
    expect(screen.getAllByText('Apr 5, 2026')).toHaveLength(2);
    expect(screen.getByText('Proposed')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('approves and rejects the specific change order', async () => {
    const user = userEvent.setup();
    show(makeContract(), [
      makeChangeOrder(),
      makeChangeOrder({ id: 'co-2', description: 'Skip the disposal', status: 'accepted' }),
    ]);

    // Only the still-proposed order is actionable.
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(h.respond.mutate).toHaveBeenLastCalledWith({
      contractId: 'contract-1',
      changeOrderId: 'co-1',
      accepted: true,
    });

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(h.respond.mutate).toHaveBeenLastCalledWith({
      contractId: 'contract-1',
      changeOrderId: 'co-1',
      accepted: false,
    });
    expect(h.respond.mutate).toHaveBeenCalledTimes(2);
  });

  it('disables both responses while one is in flight', () => {
    h.respond.isPending = true;
    show(makeContract(), [makeChangeOrder()]);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  it('the customer has no propose control', () => {
    show(makeContract(), [makeChangeOrder()]);
    expect(screen.queryByRole('button', { name: 'Propose Change Order' })).toBeNull();
  });
});

describe('ContractDetailPage — customer reports', () => {
  it('files a no-show only after confirmation and closes on success', async () => {
    const user = userEvent.setup();
    show();
    const dialog = confirmDialog('Report provider no-show?');
    expect(dialog).not.toHaveAttribute('open');

    await user.click(screen.getByRole('button', { name: 'Report no-show' }));
    expect(dialog).toHaveAttribute('open');
    expect(confirmDialog('Report abandonment?')).not.toHaveAttribute('open');
    expect(h.noShow.mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Report no-show' }));
    expect(h.noShow.mutate).toHaveBeenCalledTimes(1);
    expect(h.noShow.mutate.mock.calls[0]?.[0]).toBe('contract-1');
    expect(h.abandonment.mutate).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');

    h.noShow.mutate.mock.calls[0]?.[1]?.onSuccess?.();
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute('open');
    });
  });

  it('backing out of the no-show confirmation files nothing', async () => {
    const user = userEvent.setup();
    show();
    const dialog = confirmDialog('Report provider no-show?');
    await user.click(screen.getByRole('button', { name: 'Report no-show' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel action' }));

    expect(dialog).not.toHaveAttribute('open');
    expect(h.noShow.mutate).not.toHaveBeenCalled();
  });

  it('files abandonment against this contract and closes on success', async () => {
    const user = userEvent.setup();
    show();
    const dialog = confirmDialog('Report abandonment?');

    await user.click(screen.getByRole('button', { name: 'Report abandonment' }));
    expect(dialog).toHaveAttribute('open');
    await user.click(within(dialog).getByRole('button', { name: 'Report abandonment' }));

    expect(h.abandonment.mutate.mock.calls[0]?.[0]).toBe('contract-1');
    expect(h.noShow.mutate).not.toHaveBeenCalled();

    h.abandonment.mutate.mock.calls[0]?.[1]?.onSuccess?.();
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute('open');
    });
  });

  it('backing out of the abandonment confirmation files nothing', async () => {
    const user = userEvent.setup();
    show();
    const dialog = confirmDialog('Report abandonment?');
    await user.click(screen.getByRole('button', { name: 'Report abandonment' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel action' }));

    expect(dialog).not.toHaveAttribute('open');
    expect(h.abandonment.mutate).not.toHaveBeenCalled();
  });

  it('offers reports while acceptance is pending but not once completed', () => {
    const { unmount } = show(makeContract({ status: 'pending_acceptance' }));
    expect(screen.getByRole('button', { name: 'Report no-show' })).toBeInTheDocument();
    unmount();

    show(makeContract({ status: 'completed' }));
    expect(screen.queryByRole('button', { name: 'Report no-show' })).toBeNull();
    expect(screen.queryByText('Reports')).toBeNull();
  });
});

describe('ContractDetailPage — after completion', () => {
  it('thanks a customer who already tipped, with the tip amount', () => {
    show(makeContract({ status: 'completed', tip_amount_cents: 2550 }));
    expect(screen.getByText(/You tipped \$25\.50/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tip your provider' })).toBeNull();
  });

  it('offers the tip composer to a customer who has not tipped', () => {
    show(makeContract({ status: 'completed', tip_amount_cents: 0 }));
    expect(screen.queryByText(/You tipped/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Tip your provider' })).toBeInTheDocument();
  });

  it('never shows the tip card to the provider', () => {
    h.user = { id: 'prov-1' };
    show(makeContract({ status: 'completed' }));
    expect(screen.queryByText('Tip your provider')).toBeNull();
  });

  it('falls back to the review form link when eligibility cannot be checked', () => {
    h.eligibility.isError = true;
    show(makeContract({ status: 'completed' }));
    expect(screen.getByText(/Could not check eligibility/)).toBeInTheDocument();
    expect(screen.getByText('Leave a Review').closest('a')).toHaveAttribute(
      'href',
      '/contracts/contract-1/review',
    );
  });

  it('says "not eligible yet" when the window has not closed', () => {
    h.eligibility.data = {
      eligible: false,
      already_reviewed: false,
      review_window_closes_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    show(makeContract({ status: 'completed' }));
    expect(screen.getByText(/Not eligible yet/)).toBeInTheDocument();
    expect(screen.queryByText(/review window for this contract has closed/)).toBeNull();
    expect(screen.queryByText('Leave a Review')).toBeNull();
  });

  it('says "not eligible yet" when the server gives no window at all', () => {
    h.eligibility.data = { eligible: false, already_reviewed: false };
    show(makeContract({ status: 'completed' }));
    expect(screen.getByText(/Not eligible yet/)).toBeInTheDocument();
  });

  it('lets the provider review a completed contract too', () => {
    h.user = { id: 'prov-1' };
    h.eligibility.data = { eligible: true, already_reviewed: false };
    show(makeContract({ status: 'completed' }));
    expect(screen.getByText('Leave a Review')).toBeInTheDocument();
  });
});
