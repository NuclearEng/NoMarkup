import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MilestoneTracker } from '@/components/contracts/MilestoneTracker';
import type { Milestone } from '@/types';

interface RevisionVars {
  milestoneId: string;
  contractId: string;
  revisionNotes: string;
}

const h = vi.hoisted(() => ({
  userId: 'cust-1',
  submit: { mutate: vi.fn(), isPending: false, isError: false },
  approve: { mutate: vi.fn(), isPending: false, isError: false },
  revision: {
    mutate: vi.fn<(vars: RevisionVars, opts?: { onSuccess?: () => void }) => void>(),
    isPending: false,
    isError: false,
  },
}));

vi.mock('@/hooks/useContracts', () => ({
  useSubmitMilestone: () => h.submit,
  useApproveMilestone: () => h.approve,
  useRequestRevision: () => h.revision,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: h.userId } }),
}));

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

function renderTracker(milestones: Milestone[]) {
  return render(
    <MilestoneTracker
      milestones={milestones}
      contractId="c-1"
      customerId="cust-1"
      providerId="prov-1"
    />,
  );
}

beforeEach(() => {
  h.userId = 'cust-1';
  h.submit.mutate.mockReset();
  h.approve.mutate.mockReset();
  h.revision.mutate.mockReset();
});

describe('MilestoneTracker — unknown status and revision round trip', () => {
  it('prints a status the client does not know with spaces, and offers no action', () => {
    renderTracker([makeMilestone({ status: 'on_hold_by_admin' })]);
    expect(screen.getByText('on hold by admin')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows how many revisions have been used', () => {
    renderTracker([makeMilestone({ status: 'submitted', revision_count: 2 })]);
    expect(screen.getByText(/2\/\d+ revisions used/)).toBeInTheDocument();
  });

  it('sends the revision notes for that milestone and closes the form on success', async () => {
    const user = userEvent.setup();
    renderTracker([
      makeMilestone({ id: 'm-1', status: 'approved' }),
      makeMilestone({ id: 'm-2', sort_order: 2, status: 'submitted', description: 'Tile work' }),
    ]);

    await user.click(screen.getByRole('button', { name: /Request Revision/i }));
    const notes = screen.getByRole('textbox');
    await user.type(notes, 'The grout lines are uneven along the left wall.');
    await user.click(screen.getByRole('button', { name: /Submit Revision|Request Revision|Send/i }));

    expect(h.revision.mutate).toHaveBeenCalledTimes(1);
    expect(h.revision.mutate.mock.calls[0]?.[0]).toEqual({
      milestoneId: 'm-2',
      contractId: 'c-1',
      revisionNotes: 'The grout lines are uneven along the left wall.',
    });
    // Still open until the server accepts.
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    h.revision.mutate.mock.calls[0]?.[1]?.onSuccess?.();
    await vi.waitFor(() => {
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });
});
