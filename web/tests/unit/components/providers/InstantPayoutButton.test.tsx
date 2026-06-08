import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstantPayoutButton } from '@/components/providers/InstantPayoutButton';

const mutate = vi.fn();

vi.mock('@/hooks/usePayments', () => ({
  useInstantPayout: () => ({
    mutate,
    isPending: false,
  }),
}));

// Feature-flag gating is covered separately (feature-flag-gating.test.tsx);
// here we exercise the flag-ON path so the card renders.
vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: () => true,
  useFeatureFlags: () => ({}),
}));

describe('InstantPayoutButton', () => {
  beforeEach(() => {
    mutate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders title and Instant Payout button', () => {
    render(<InstantPayoutButton availableBalanceCents={50000} />);
    // "Instant Payout" appears as both title and button label
    expect(screen.getAllByText('Instant Payout').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /Instant Payout/ })).toBeDefined();
  });

  it('shows the available balance hint', () => {
    render(<InstantPayoutButton availableBalanceCents={123400} />);
    expect(screen.getByText(/Available:/)).toBeDefined();
  });

  it('disables submit when amount is zero', () => {
    render(<InstantPayoutButton availableBalanceCents={0} />);
    const button = screen.getByRole('button', { name: /Instant Payout/ });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('calls instant payout mutation with the amount in cents on submit', async () => {
    const user = userEvent.setup();
    render(<InstantPayoutButton availableBalanceCents={20000} />);
    // default value pre-fills max as integer dollars (200)
    const button = screen.getByRole('button', { name: /Instant Payout/ });
    await user.click(button);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(20000);
  });

  it('shows fee breakdown panel when amount is positive', () => {
    render(<InstantPayoutButton availableBalanceCents={10000} />);
    expect(screen.getByText('Amount')).toBeDefined();
    expect(screen.getByText(/Fee \(1%\)/)).toBeDefined();
    expect(screen.getByText('You receive')).toBeDefined();
  });
});
