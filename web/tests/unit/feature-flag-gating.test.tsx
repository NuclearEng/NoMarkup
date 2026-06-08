import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FeatureFlagKey } from '@/hooks/useFeatureFlags';

// Mock the flags map the hook reads. Tests mutate `flagState` per-case.
let flagState: Partial<Record<FeatureFlagKey, boolean>> = {};

vi.mock('@/hooks/useFeatureFlags', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useFeatureFlags')>('@/hooks/useFeatureFlags');
  return {
    ...actual,
    useFeatureFlags: () => flagState,
    // Mirror the real fail-open accessor: enabled unless explicitly `false`.
    useFeatureFlag: (key: FeatureFlagKey) => flagState[key] ?? true,
  };
});

// Avoid pulling the real payment mutation (and its api client) into the test.
vi.mock('@/hooks/usePayments', () => ({
  useInstantPayout: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { InstantPayoutButton } = await import('@/components/providers/InstantPayoutButton');

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(QueryClientProvider, { client }, ui),
  );
}

afterEach(() => {
  flagState = {};
});

describe('feature-flag gating — InstantPayout card', () => {
  it('renders the Instant Payout card when the flag is ON', () => {
    flagState = { instant_payout: true };
    renderWithClient(createElement(InstantPayoutButton, { availableBalanceCents: 50_000 }));
    // "Instant Payout" appears as both the card title and the submit button.
    expect(screen.getAllByText('Instant Payout').length).toBeGreaterThan(0);
  });

  it('hides the Instant Payout card when the flag is OFF', () => {
    flagState = { instant_payout: false };
    const { container } = renderWithClient(
      createElement(InstantPayoutButton, { availableBalanceCents: 50_000 }),
    );
    expect(screen.queryByText('Instant Payout')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('defaults to SHOWING the card when the flag is missing (fail-open)', () => {
    flagState = {}; // flag not present in the map → treated as enabled
    renderWithClient(createElement(InstantPayoutButton, { availableBalanceCents: 50_000 }));
    expect(screen.getAllByText('Instant Payout').length).toBeGreaterThan(0);
  });
});

describe('useFeatureFlag — fail-open default (real implementation)', () => {
  it('defaults missing/loading flags to enabled', async () => {
    const { renderHook } = await import('@testing-library/react');
    const actual =
      await vi.importActual<typeof import('@/hooks/useFeatureFlags')>('@/hooks/useFeatureFlags');

    // Use the real hook against an empty query cache (simulates loading/missing).
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => actual.useFeatureFlag('working_capital'), { wrapper });
    expect(result.current).toBe(true);
  });
});
