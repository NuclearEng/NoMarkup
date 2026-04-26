import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionFlow } from '@/components/contracts/CompletionFlow';
import type { Contract, Milestone } from '@/types';

const mockMarkComplete = vi.fn();
const mockApprove = vi.fn();
const mockRequestRevision = vi.fn();

const markState: { isPending: boolean; isError: boolean } = { isPending: false, isError: false };
const approveState: { isPending: boolean; isError: boolean } = { isPending: false, isError: false };
const revisionState: { isPending: boolean; isError: boolean } = { isPending: false, isError: false };

vi.mock('@/hooks/useContracts', () => ({
  useMarkComplete: () => ({
    mutate: mockMarkComplete,
    get isPending() {
      return markState.isPending;
    },
    get isError() {
      return markState.isError;
    },
  }),
  useApproveCompletion: () => ({
    mutate: mockApprove,
    get isPending() {
      return approveState.isPending;
    },
    get isError() {
      return approveState.isError;
    },
  }),
  useRequestRevision: () => ({
    mutate: mockRequestRevision,
    get isPending() {
      return revisionState.isPending;
    },
    get isError() {
      return revisionState.isError;
    },
  }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const { useAuthStore } = await import('@/stores/auth-store');

function setUser(user: { id: string } | null) {
  vi.mocked(useAuthStore).mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user, isAuthenticated: !!user, token: null }),
  );
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm-1',
    contract_id: 'c-1',
    description: 'Milestone',
    amount_cents: 10000,
    sort_order: 1,
    status: 'approved',
    revision_count: 0,
    revision_notes: '',
    ...overrides,
  };
}

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'c-1',
    contract_number: 'CON-001',
    job_id: 'job-1',
    job_title: 'Job',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    bid_id: 'bid-1',
    amount_cents: 50000,
    payment_timing: 'milestone',
    status: 'active',
    customer_accepted: true,
    provider_accepted: true,
    acceptance_deadline: '2099-01-01T00:00:00Z',
    milestones: [makeMilestone()],
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

describe('CompletionFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markState.isPending = false;
    markState.isError = false;
    approveState.isPending = false;
    approveState.isError = false;
    revisionState.isPending = false;
    revisionState.isError = false;
  });

  it('renders nothing for users that are neither customer nor provider', () => {
    setUser({ id: 'someone-else' });
    const { container } = render(createElement(CompletionFlow, { contract: makeContract() }));
    expect(container.firstChild).toBeNull();
  });

  it('shows Mark Work Complete for provider when all milestones approved', async () => {
    setUser({ id: 'prov-1' });
    const user = userEvent.setup();
    render(createElement(CompletionFlow, { contract: makeContract() }));

    const btn = screen.getByRole('button', { name: /mark work complete/i });
    await user.click(btn);
    expect(mockMarkComplete).toHaveBeenCalledWith('c-1');
  });

  it('shows waiting state when provider has marked complete', () => {
    setUser({ id: 'prov-1' });
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    expect(screen.getByText(/Waiting for customer approval/i)).toBeDefined();
  });

  it('shows approve and request revision buttons for the customer when work is complete', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );

    expect(screen.getByText(/The provider has marked this work as complete/i)).toBeDefined();
    const approveBtn = screen.getByRole('button', { name: /approve completion/i });
    await user.click(approveBtn);
    expect(mockApprove).toHaveBeenCalledWith('c-1');
  });

  it('reveals revision form when Request Revision is clicked', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );

    await user.click(screen.getByRole('button', { name: /request revision/i }));
    expect(
      screen.getByPlaceholderText(/Describe what changes are needed/i),
    ).toBeDefined();
  });

  // ---- DEEPENING TESTS ----

  it('renders nothing for a provider when no milestones are approved yet', () => {
    setUser({ id: 'prov-1' });
    const { container } = render(
      createElement(CompletionFlow, {
        contract: makeContract({
          milestones: [makeMilestone({ status: 'pending' })],
        }),
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the customer waiting summary with the formatted completion date', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    // The contract amount is rendered formatted as USD
    expect(screen.getByText('$500.00')).toBeDefined();
    // Year visible in formatted date
    expect(screen.getByText(/2026/)).toBeDefined();
  });

  it('shows a validation error when revision notes are too short', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    const textarea = screen.getByPlaceholderText(/Describe what changes are needed/i);
    await user.type(textarea, 'too short');
    await user.click(screen.getByRole('button', { name: /submit revision request/i }));
    expect(screen.getByText(/at least 10 characters/i)).toBeDefined();
    expect(mockRequestRevision).not.toHaveBeenCalled();
  });

  it('submits a valid revision request with the milestone id and notes', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    const textarea = screen.getByPlaceholderText(/Describe what changes are needed/i);
    await user.type(textarea, 'Please re-paint the trim, it was missed.');
    await user.click(screen.getByRole('button', { name: /submit revision request/i }));
    expect(mockRequestRevision).toHaveBeenCalledTimes(1);
    const [args] = mockRequestRevision.mock.calls[0] as [
      { milestoneId: string; contractId: string; revisionNotes: string },
    ];
    expect(args.milestoneId).toBe('m-1');
    expect(args.contractId).toBe('c-1');
    expect(args.revisionNotes).toContain('re-paint');
  });

  it('cancels the revision form and clears the notes textarea', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    const textarea = screen.getByPlaceholderText(/Describe what changes are needed/i);
    await user.type(textarea, 'something something');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    // The original Approve / Request Revision buttons return
    expect(screen.getByRole('button', { name: /approve completion/i })).toBeDefined();
    expect(screen.queryByPlaceholderText(/Describe what changes are needed/i)).toBeNull();
  });

  it('renders the approved-amount summary for the provider when all milestones are approved', () => {
    setUser({ id: 'prov-1' });
    render(
      createElement(CompletionFlow, {
        contract: makeContract({
          milestones: [
            makeMilestone({ id: 'm-1', amount_cents: 30000, status: 'approved' }),
            makeMilestone({ id: 'm-2', amount_cents: 20000, status: 'approved' }),
          ],
        }),
      }),
    );
    // Total approved = 30000 + 20000 = $500
    expect(screen.getByText('$500.00')).toBeDefined();
    expect(screen.getByText(/2 \/ 2 Approved/)).toBeDefined();
  });

  it('selects the milestone with the highest sort_order for revision requests', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(CompletionFlow, {
        contract: makeContract({
          completed_at: '2026-04-22T00:00:00Z',
          milestones: [
            makeMilestone({ id: 'm-a', sort_order: 1 }),
            makeMilestone({ id: 'm-z', sort_order: 5 }),
            makeMilestone({ id: 'm-b', sort_order: 3 }),
          ],
        }),
      }),
    );
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    const textarea = screen.getByPlaceholderText(/Describe what changes are needed/i);
    await user.type(textarea, 'Need a thorough do-over of the work.');
    await user.click(screen.getByRole('button', { name: /submit revision request/i }));
    const [args] = mockRequestRevision.mock.calls[0] as [
      { milestoneId: string },
    ];
    expect(args.milestoneId).toBe('m-z');
  });

  // ---- WAVE 13 DEEPENING TESTS ----

  it('renders nothing for the customer when no milestones exist', () => {
    setUser({ id: 'cust-1' });
    const { container } = render(
      createElement(CompletionFlow, {
        contract: makeContract({ milestones: [], completed_at: null }),
      }),
    );
    // Empty milestones → not allMilestonesApproved + no completed_at → falls to null.
    expect(container.firstChild).toBeNull();
  });

  it('shows the marking-complete loading state for the provider while pending', () => {
    setUser({ id: 'prov-1' });
    markState.isPending = true;
    render(createElement(CompletionFlow, { contract: makeContract() }));
    const btn = screen.getByRole<HTMLButtonElement>('button', {
      name: /Marking Complete/i,
    });
    expect(btn.disabled).toBe(true);
  });

  it('shows the mark-complete error state for the provider', () => {
    setUser({ id: 'prov-1' });
    markState.isError = true;
    render(createElement(CompletionFlow, { contract: makeContract() }));
    expect(screen.getByText(/Failed to mark as complete/i)).toBeDefined();
  });

  it('shows the approving loading state for the customer', () => {
    setUser({ id: 'cust-1' });
    approveState.isPending = true;
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    expect(screen.getByRole('button', { name: /Approving/i })).toBeDefined();
  });

  it('shows the approve error message for the customer', () => {
    setUser({ id: 'cust-1' });
    approveState.isError = true;
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    expect(screen.getByText(/Failed to approve completion/i)).toBeDefined();
  });

  it('shows the revision-submission loading state', async () => {
    setUser({ id: 'cust-1' });
    revisionState.isPending = true;
    const user = userEvent.setup();
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    expect(screen.getByText(/Submitting/i)).toBeDefined();
  });

  it('shows the revision error message after submit fails', async () => {
    setUser({ id: 'cust-1' });
    revisionState.isError = true;
    const user = userEvent.setup();
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    expect(screen.getByText(/Failed to request revision/i)).toBeDefined();
  });

  it('clears the revision form after a successful revision submission', async () => {
    setUser({ id: 'cust-1' });
    mockRequestRevision.mockImplementation(
      (
        _vars: { milestoneId: string; contractId: string; revisionNotes: string },
        opts?: { onSuccess?: () => void },
      ) => {
        opts?.onSuccess?.();
      },
    );
    const user = userEvent.setup();
    render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: '2026-04-22T00:00:00Z' }),
      }),
    );
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    const textarea = screen.getByPlaceholderText(/Describe what changes are needed/i);
    await user.type(textarea, 'Please revise the install fully.');
    await user.click(screen.getByRole('button', { name: /submit revision request/i }));
    // onSuccess flips showRevisionForm back to false → original buttons return.
    expect(screen.queryByPlaceholderText(/Describe what changes are needed/i)).toBeNull();
    expect(screen.getByRole('button', { name: /approve completion/i })).toBeDefined();
  });

  it('renders the customer waiting card without the completion-date row when completed_at is null', () => {
    // The customer-marked-complete branch is gated by providerMarkedComplete,
    // which depends on completed_at being set. With completed_at = null, that
    // branch is skipped — the provider mark-complete card is the active path.
    // The customer view in this case returns the final null because no
    // matching branch is true.
    setUser({ id: 'cust-1' });
    const { container } = render(
      createElement(CompletionFlow, {
        contract: makeContract({ completed_at: null }),
      }),
    );
    expect(container.firstChild).toBeNull();
  });
});
