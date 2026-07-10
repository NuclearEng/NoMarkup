import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FeatureFlagKey } from '@/hooks/useFeatureFlags';
import { defaultFeatureFlagValue } from '@/hooks/useFeatureFlags';

// Mock the flags map the hook reads. Tests mutate `flagState` per-case.
let flagState: Partial<Record<FeatureFlagKey, boolean>> = {};

vi.mock('@/hooks/useFeatureFlags', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useFeatureFlags')>('@/hooks/useFeatureFlags');
  return {
    ...actual,
    useFeatureFlags: () => flagState,
    // Mirror the real accessor: financial keys fail-closed, core flags fail-open.
    useFeatureFlag: (key: FeatureFlagKey) =>
      flagState[key] ?? actual.defaultFeatureFlagValue(key),
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

  it('defaults to HIDING the card when the flag is missing (fail-closed, SEC-02)', () => {
    flagState = {}; // financial flag not present → treated as disabled
    const { container } = renderWithClient(
      createElement(InstantPayoutButton, { availableBalanceCents: 50_000 }),
    );
    expect(screen.queryByText('Instant Payout')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('useFeatureFlag — financial fail-closed / core fail-open (real implementation)', () => {
  it('defaults missing financial flags to disabled', async () => {
    const { renderHook } = await import('@testing-library/react');
    const actual =
      await vi.importActual<typeof import('@/hooks/useFeatureFlags')>('@/hooks/useFeatureFlags');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => actual.useFeatureFlag('working_capital'), { wrapper });
    expect(result.current).toBe(false);
  });

  it('defaults missing core flags to enabled', async () => {
    const { renderHook } = await import('@testing-library/react');
    const actual =
      await vi.importActual<typeof import('@/hooks/useFeatureFlags')>('@/hooks/useFeatureFlags');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => actual.useFeatureFlag('live_auction'), { wrapper });
    expect(result.current).toBe(true);
  });

  it('defaultFeatureFlagValue documents the financial set', () => {
    expect(defaultFeatureFlagValue('customer_bnpl')).toBe(false);
    expect(defaultFeatureFlagValue('instant_payout')).toBe(false);
    expect(defaultFeatureFlagValue('legal_services')).toBe(false);
    expect(defaultFeatureFlagValue('lead_gen')).toBe(false);
    expect(defaultFeatureFlagValue('live_auction')).toBe(true);
    expect(defaultFeatureFlagValue('spectator_mode')).toBe(true);
  });
});
