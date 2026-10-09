import { render, screen } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GuaranteeCoverage } from '@/components/contracts/GuaranteeCoverage';
import type { Contract } from '@/types';

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const { useAuthStore } = await import('@/stores/auth-store');

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'c-1',
    contract_number: 'CON-001',
    job_id: 'job-1',
    job_title: 'Test',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    bid_id: 'bid-1',
    amount_cents: 50000,
    payment_timing: 'milestone',
    status: 'active',
    customer_accepted: true,
    provider_accepted: true,
    acceptance_deadline: '2026-05-01T00:00:00Z',
    milestones: [],
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function setUser(user: { id: string } | null) {
  vi.mocked(useAuthStore).mockImplementation(
    ((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user, isAuthenticated: !!user, token: null })) as unknown as typeof useAuthStore,
  );
}

describe('GuaranteeCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when contract is in a non-eligible state', () => {
    setUser({ id: 'cust-1' });
    const { container } = render(
      createElement(GuaranteeCoverage, {
        contract: makeContract({ status: 'pending_acceptance' }),
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders coverage list for active contracts', () => {
    setUser({ id: 'cust-1' });
    render(createElement(GuaranteeCoverage, { contract: makeContract() }));
    expect(screen.getByText('Protected by NoMarkup Guarantee')).toBeDefined();
    expect(screen.getByText('Quality assurance')).toBeDefined();
    expect(screen.getByText('On-time completion')).toBeDefined();
    expect(screen.getByText('No-show protection')).toBeDefined();
    expect(screen.getByText('Abandonment protection')).toBeDefined();
  });

  it('shows File a Claim button only for the customer', () => {
    setUser({ id: 'cust-1' });
    const { rerender } = render(
      createElement(GuaranteeCoverage, { contract: makeContract() }),
    );
    expect(screen.getByRole('button', { name: /file a claim/i })).toBeDefined();

    setUser({ id: 'prov-1' });
    rerender(createElement(GuaranteeCoverage, { contract: makeContract() }));
    expect(screen.queryByRole('button', { name: /file a claim/i })).toBeNull();
  });

  it('renders for completed contracts as well', () => {
    setUser({ id: 'cust-1' });
    render(
      createElement(GuaranteeCoverage, {
        contract: makeContract({ status: 'completed' }),
      }),
    );
    expect(screen.getByText('Protected by NoMarkup Guarantee')).toBeDefined();
  });
});

// Wrapper helper kept for completeness even though not all tests use it.
export function _testWrapper({ children }: { children: ReactNode }) {
  return children;
}
