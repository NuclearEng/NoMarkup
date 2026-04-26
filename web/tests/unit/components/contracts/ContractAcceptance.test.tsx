import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContractAcceptance } from '@/components/contracts/ContractAcceptance';
import type { Contract } from '@/types';

const mockAcceptMutate = vi.fn();
const mockCancelMutate = vi.fn();

let acceptState = { isPending: false, isError: false };
let cancelState = { isPending: false, isError: false };

vi.mock('@/hooks/useContracts', () => ({
  useAcceptContract: () => ({
    mutate: mockAcceptMutate,
    get isPending() {
      return acceptState.isPending;
    },
    get isError() {
      return acceptState.isError;
    },
  }),
  useCancelContract: () => ({
    mutate: mockCancelMutate,
    get isPending() {
      return cancelState.isPending;
    },
    get isError() {
      return cancelState.isError;
    },
  }),
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
    acceptState = { isPending: false, isError: false };
    cancelState = { isPending: false, isError: false };
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

  it('shows "Accepting..." loading state when accept mutation is pending', () => {
    acceptState = { isPending: true, isError: false };
    setUser({ id: 'cust-1' });
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    expect(screen.getByText(/Accepting\.\.\./i)).toBeDefined();
  });

  it('shows accept error message when acceptContract.isError is true', () => {
    acceptState = { isPending: false, isError: true };
    setUser({ id: 'cust-1' });
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    expect(screen.getByText(/Failed to accept contract/i)).toBeDefined();
  });

  it('confirms decline and calls cancel mutate with onSuccess clearing confirm view', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(createElement(ContractAcceptance, { contract: makeContract() }));

    await user.click(screen.getByRole('button', { name: /decline/i }));
    const confirmBtn = screen.getByRole('button', { name: /confirm decline/i });
    await user.click(confirmBtn);

    expect(mockCancelMutate).toHaveBeenCalledTimes(1);
    const firstCall = mockCancelMutate.mock.calls[0] as
      | [string, { onSuccess: () => void }]
      | undefined;
    const contractId = firstCall?.[0];
    const options = firstCall?.[1];
    expect(contractId).toBe('c-1');
    // simulate onSuccess from the hook
    act(() => {
      options?.onSuccess();
    });
    // confirmation banner should now be hidden — back to normal Accept/Decline buttons
    expect(screen.queryByText(/Are you sure you want to decline/i)).toBeNull();
  });

  it('shows "Declining..." loading state when cancel mutation is pending', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    await user.click(screen.getByRole('button', { name: /decline/i }));

    cancelState = { isPending: true, isError: false };
    // re-render with new pending state by toggling something — the easiest path is to assert
    // the existing render will read the getter; since the state is read on each render, we need
    // a state change to trigger re-render. Instead, render again.
    render(createElement(ContractAcceptance, { contract: makeContract({ id: 'c-2' }) }));
    await user.click(screen.getAllByRole('button', { name: /decline/i })[1] as HTMLElement);
    expect(screen.getByText(/Declining\.\.\./i)).toBeDefined();
  });

  it('shows decline error after cancel fails', async () => {
    setUser({ id: 'cust-1' });
    cancelState = { isPending: false, isError: true };
    const user = userEvent.setup();
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    await user.click(screen.getByRole('button', { name: /decline/i }));
    expect(screen.getByText(/Failed to decline contract/i)).toBeDefined();
  });

  it('Cancel button in decline confirm dismisses the confirmation', async () => {
    setUser({ id: 'cust-1' });
    const user = userEvent.setup();
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    await user.click(screen.getByRole('button', { name: /decline/i }));
    expect(screen.getByText(/Are you sure you want to decline/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Are you sure you want to decline/i)).toBeNull();
  });

  it('renders the action panel for the provider as well', () => {
    setUser({ id: 'prov-1' });
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    expect(screen.getByRole('button', { name: /accept contract/i })).toBeDefined();
  });

  it('hides the action panel for unrelated users (neither customer nor provider)', () => {
    setUser({ id: 'someone-else' });
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    expect(screen.queryByRole('button', { name: /accept contract/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /decline/i })).toBeNull();
  });

  it('hides the action panel when no user is signed in', () => {
    setUser(null);
    render(createElement(ContractAcceptance, { contract: makeContract() }));
    expect(screen.queryByRole('button', { name: /accept contract/i })).toBeNull();
  });

  it('shows provider-accepted status badge when provider already accepted', () => {
    setUser({ id: 'prov-1' });
    render(
      createElement(ContractAcceptance, {
        contract: makeContract({ provider_accepted: true }),
      }),
    );
    expect(screen.getByText(/Provider Accepted/)).toBeDefined();
    expect(screen.getByText(/You have already accepted this contract/i)).toBeDefined();
  });

  it('renders 1 milestone (singular text) and multiple milestones (plural text)', () => {
    setUser({ id: 'cust-1' });
    const single = render(
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
    expect(single.getByText(/^1 milestone$/)).toBeDefined();
    single.unmount();

    render(
      createElement(ContractAcceptance, {
        contract: makeContract({
          milestones: [
            {
              id: 'm-1',
              contract_id: 'c-1',
              description: 'A',
              amount_cents: 1000,
              sort_order: 1,
              status: 'pending',
              revision_count: 0,
              revision_notes: '',
            },
            {
              id: 'm-2',
              contract_id: 'c-1',
              description: 'B',
              amount_cents: 2000,
              sort_order: 2,
              status: 'pending',
              revision_count: 0,
              revision_notes: '',
            },
          ],
        }),
      }),
    );
    expect(screen.getByText(/^2 milestones$/)).toBeDefined();
  });
});
