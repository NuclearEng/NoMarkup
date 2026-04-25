import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionFlow } from '@/components/contracts/CompletionFlow';
import type { Contract, Milestone } from '@/types';

const mockMarkComplete = vi.fn();
const mockApprove = vi.fn();
const mockRequestRevision = vi.fn();

vi.mock('@/hooks/useContracts', () => ({
  useMarkComplete: () => ({ mutate: mockMarkComplete, isPending: false, isError: false }),
  useApproveCompletion: () => ({ mutate: mockApprove, isPending: false, isError: false }),
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
});
