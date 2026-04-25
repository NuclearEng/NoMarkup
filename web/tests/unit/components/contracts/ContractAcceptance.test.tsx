import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContractAcceptance } from '@/components/contracts/ContractAcceptance';
import type { Contract } from '@/types';

const mockAcceptMutate = vi.fn();
const mockCancelMutate = vi.fn();

vi.mock('@/hooks/useContracts', () => ({
  useAcceptContract: () => ({
    mutate: mockAcceptMutate,
    isPending: false,
    isError: false,
  }),
  useCancelContract: () => ({
    mutate: mockCancelMutate,
    isPending: false,
    isError: false,
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

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'c-1',
    contract_number: 'CON-001',
    job_id: 'job-1',
    job_title: 'Job title',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    bid_id: 'bid-1',
    amount_cents: 50000,
    payment_timing: 'milestone',
    status: 'pending_acceptance',
    customer_accepted: false,
    provider_accepted: false,
    acceptance_deadline: '2099-01-01T00:00:00Z',
    milestones: [],
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

describe('ContractAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders contract terms and total amount', () => {
    setUser({ id: 'cust-1' });
    render(createElement(ContractAcceptance, { contract: makeContract({ amount_cents: 75000 }) }));
    expect(screen.getByText('Contract Acceptance')).toBeDefined();
    expect(screen.getByText('$750.00')).toBeDefined();
  });

  it('shows pending status for both parties initially', () => {
    setUser({ id: 'cust-1' });
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    expect(screen.getByText('Customer Pending')).toBeDefined();
    expect(screen.getByText('Provider Pending')).toBeDefined();
  });

  it('shows Accept button for the customer and triggers mutation', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(createElement(ContractAcceptance, { contract: makeContract() }));

    const acceptBtn = screen.getByRole('button', { name: /accept contract/i });
    await user.click(acceptBtn);
    expect(mockAcceptMutate).toHaveBeenCalledWith('c-1');
  });

  it('reveals decline confirmation when Decline is clicked', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    await user.click(screen.getByRole('button', { name: /decline/i }));
    expect(screen.getByText(/Are you sure you want to decline/i)).toBeDefined();
  });

  it('shows already-accepted message for the side that already accepted', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(ContractAcceptance, {
        contract: makeContract({ customer_accepted: true }),
      }),
    );
    expect(screen.getByText(/Customer Accepted/)).toBeDefined();
    expect(screen.getByText(/You have already accepted this contract/i)).toBeDefined();
  });

  it('lists milestones when present', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(ContractAcceptance, {
        contract: makeContract({
          milestones: [
            {
              id: 'm-1',
              contract_id: 'c-1',
              description: 'Initial',
              amount_cents: 10000,
              sort_order: 1,
              status: 'pending',
              revision_count: 0,
              revision_notes: '',
            },
          ],
        }),
      }),
    );
    expect(screen.getByText(/1\. Initial/)).toBeDefined();
  });
});
