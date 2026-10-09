import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MilestoneTracker } from '@/components/contracts/MilestoneTracker';
import type { Milestone } from '@/types';

const mockSubmitMilestone = vi.fn();
const mockApproveMilestone = vi.fn();
const mockRequestRevision = vi.fn();

const submitState = { mutate: mockSubmitMilestone, isPending: false, isError: false };
const approveState = { mutate: mockApproveMilestone, isPending: false, isError: false };
const revisionState = { mutate: mockRequestRevision, isPending: false, isError: false };

vi.mock('@/hooks/useContracts', () => ({
  useSubmitMilestone: () => submitState,
  useApproveMilestone: () => approveState,
  useRequestRevision: () => revisionState,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const { useAuthStore } = await import('@/stores/auth-store');

function setUser(user: { id: string } | null) {
  vi.mocked(useAuthStore).mockImplementation(
    ((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user, isAuthenticated: !!user, token: null })) as unknown as typeof useAuthStore,
  );
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm-1',
    contract_id: 'c-1',
    description: 'Demo work',
    amount_cents: 10000,
    sort_order: 1,
    status: 'in_progress',
    revision_count: 0,
    revision_notes: '',
    ...overrides,
  };
}

function resetMutationState(): void {
  submitState.isPending = false;
  submitState.isError = false;
  approveState.isPending = false;
  approveState.isError = false;
  revisionState.isPending = false;
  revisionState.isError = false;
}

describe('MilestoneTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMutationState();
  });

  it('renders empty state when no milestones', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/No milestones defined/i)).toBeDefined();
  });

  it('renders milestone descriptions and amounts', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [
          makeMilestone({ id: 'm-1', description: 'First', amount_cents: 25000 }),
          makeMilestone({ id: 'm-2', description: 'Second', amount_cents: 75000, sort_order: 2 }),
        ],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText('First')).toBeDefined();
    expect(screen.getByText('Second')).toBeDefined();
    expect(screen.getByText('$250.00')).toBeDefined();
    expect(screen.getByText('$750.00')).toBeDefined();
  });

  it('shows Submit for Review button to provider for in_progress milestones', async () => {
    setUser({ id: 'prov-1' });
    const user = userEvent.setup();
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'in_progress' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    const btn = screen.getByRole('button', { name: /submit for review/i });
    await user.click(btn);
    expect(mockSubmitMilestone).toHaveBeenCalledWith({ milestoneId: 'm-1', contractId: 'c-1' });
  });

  it('shows Approve button to customer for submitted milestones', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'submitted' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    const approveBtn = screen.getByRole('button', { name: /^approve$/i });
    await user.click(approveBtn);
    expect(mockApproveMilestone).toHaveBeenCalledWith({ milestoneId: 'm-1', contractId: 'c-1' });
  });

  it('shows revision notes when status is revision_requested', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [
          makeMilestone({
            status: 'revision_requested',
            revision_notes: 'Please redo the trim',
            revision_count: 1,
          }),
        ],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/Please redo the trim/i)).toBeDefined();
    expect(screen.getByText(/1\/3 revisions used/i)).toBeDefined();
  });

  it('shows Resubmit button to provider for revision_requested milestones', async () => {
    setUser({ id: 'prov-1' });
    const user = userEvent.setup();
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'revision_requested' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    const btn = screen.getByRole('button', { name: /resubmit for review/i });
    await user.click(btn);
    expect(mockSubmitMilestone).toHaveBeenCalled();
  });

  it('opens the revision form, validates short input, then submits', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'submitted' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    // Open the revision form via the secondary "Request Revision" button.
    const openBtn = screen.getByRole('button', { name: /request revision/i });
    await user.click(openBtn);

    // Now we have a textarea.
    const ta = screen.getByPlaceholderText(/Describe what changes are needed/i);
    await user.type(ta, 'too short');
    const submitBtn = screen.getByRole('button', { name: /^request revision$/i });
    await user.click(submitBtn);
    // Expect a validation error to appear.
    expect(screen.getAllByText(/at least|minimum|10 chars|10 characters/i).length).toBeGreaterThan(0);
    expect(mockRequestRevision).not.toHaveBeenCalled();

    // Provide enough text and submit again.
    await user.clear(ta);
    await user.type(ta, 'this is a long enough description of the issue');
    await user.click(submitBtn);
    expect(mockRequestRevision).toHaveBeenCalled();
    const callArgs = mockRequestRevision.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs).toBeDefined();
    expect((callArgs as { contractId: string }).contractId).toBe('c-1');
  });

  it('cancels the revision form and clears state', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'submitted' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    const ta = screen.getByPlaceholderText(/Describe what changes are needed/i);
    await user.type(ta, 'some notes here');
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    // Approve button should be visible again.
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDefined();
  });

  it('hides the Request Revision button when revision_count has reached the max', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'submitted', revision_count: 3 })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.queryByRole('button', { name: /request revision/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDefined();
  });

  it('renders submit-error message for provider when submit mutation failed', () => {
    submitState.isError = true;
    setUser({ id: 'prov-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'in_progress' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/Failed to submit milestone/i)).toBeDefined();
  });

  it('renders approve-error message for customer when approve mutation failed', () => {
    approveState.isError = true;
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'submitted' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/Failed to approve milestone/i)).toBeDefined();
  });

  it('disables the submit button while submission is pending', () => {
    submitState.isPending = true;
    setUser({ id: 'prov-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'in_progress' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    const btn = screen.getByRole('button', { name: /submitting/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows Approving... when approval mutation is pending', () => {
    approveState.isPending = true;
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'submitted' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/Approving/)).toBeDefined();
  });

  it('renders the Approved badge with date for approved milestones', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [
          makeMilestone({
            status: 'approved',
            approved_at: '2026-03-15T12:00:00Z',
          } as Partial<Milestone>),
        ],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/Approved on/)).toBeDefined();
    expect(screen.getByText(/Mar/)).toBeDefined();
  });

  it('renders the Submitted date when present', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [
          makeMilestone({
            status: 'submitted',
            submitted_at: '2026-02-10T09:00:00Z',
          } as Partial<Milestone>),
        ],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/Submitted on/)).toBeDefined();
  });

  it('renders the Disputed badge for disputed milestones', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'disputed' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/Disputed/)).toBeDefined();
  });

  it('renders the Pending badge for pending milestones', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'pending' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText('Pending')).toBeDefined();
  });

  it('shows no provider/customer actions when viewer is neither party', () => {
    setUser({ id: 'someone-else' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'in_progress' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.queryByRole('button', { name: /submit for review/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
  });

  it('shows "Resubmitting..." spinner for provider on revision_requested while pending', () => {
    submitState.isPending = true;
    setUser({ id: 'prov-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'revision_requested' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/Resubmitting/)).toBeDefined();
  });

  it('renders submit-error for provider on revision_requested when submit failed', () => {
    submitState.isError = true;
    setUser({ id: 'prov-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'revision_requested' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    expect(screen.getByText(/Failed to submit milestone/i)).toBeDefined();
  });

  it('shows the "Requesting..." spinner while requestRevision is pending', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'submitted' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    // Open the revision form first (button visible only before pending flips).
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    // Now flip pending state and re-render.
    revisionState.isPending = true;
    // Forces React to flush the new pending state via a typing event.
    const ta = screen.getByPlaceholderText(/Describe what changes are needed/i);
    await user.type(ta, 'a');
    expect(screen.getByText(/Requesting/)).toBeDefined();
    // Cancel and revision-request action buttons should be disabled while pending.
    const reqBtn = screen.getByRole('button', { name: /requesting/i });
    if (!(reqBtn instanceof HTMLButtonElement)) throw new Error('expected button element');
    expect(reqBtn.disabled).toBe(true);
  });

  it('renders revision-error message when requestRevision mutation failed', async () => {
    revisionState.isError = true;
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(
      createElement(MilestoneTracker, {
        milestones: [makeMilestone({ status: 'submitted' })],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    await user.click(screen.getByRole('button', { name: /request revision/i }));
    expect(screen.getByText(/Failed to request revision/i)).toBeDefined();
  });

  it('orders milestones by sort_order', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(MilestoneTracker, {
        milestones: [
          makeMilestone({ id: 'b', description: 'Second one', sort_order: 2 }),
          makeMilestone({ id: 'a', description: 'First one', sort_order: 1 }),
        ],
        contractId: 'c-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
      }),
    );
    const headings = screen.getAllByText(/^Milestone \d/);
    expect(headings[0]?.textContent).toBe('Milestone 1');
    expect(headings[1]?.textContent).toBe('Milestone 2');
  });
});
