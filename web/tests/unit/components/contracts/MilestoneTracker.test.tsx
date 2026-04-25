import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MilestoneTracker } from '@/components/contracts/MilestoneTracker';
import type { Milestone } from '@/types';

const mockSubmitMilestone = vi.fn();
const mockApproveMilestone = vi.fn();
const mockRequestRevision = vi.fn();

vi.mock('@/hooks/useContracts', () => ({
  useSubmitMilestone: () => ({ mutate: mockSubmitMilestone, isPending: false, isError: false }),
  useApproveMilestone: () => ({ mutate: mockApproveMilestone, isPending: false, isError: false }),
  useRequestRevision: () => ({ mutate: mockRequestRevision, isPending: false, isError: false }),
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
    description: 'Demo work',
    amount_cents: 10000,
    sort_order: 1,
    status: 'in_progress',
    revision_count: 0,
    revision_notes: '',
    ...overrides,
  };
}

describe('MilestoneTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
