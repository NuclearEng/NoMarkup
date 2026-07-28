// Behavior tests for the admin Feature Flags page.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminFeatureFlag } from '@/hooks/useAdmin';

import { withQueryClient } from './_helpers';

// Radix Slider observes container size — jsdom has no ResizeObserver.
globalThis.ResizeObserver = class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof globalThis.ResizeObserver;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/flags',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => { toastSuccess(...args); },
    error: (...args: unknown[]) => { toastError(...args); },
  },
}));

const useAdminFlagsMock = vi.fn();
const toggleMutateAsync = vi.fn();
const useToggleFlagMock = vi.fn();

vi.mock('@/hooks/useAdmin', () => ({
  useAdminFlags: (...args: unknown[]) => useAdminFlagsMock(...args) as unknown,
  useToggleFlag: (...args: unknown[]) => useToggleFlagMock(...args) as unknown,
}));

import AdminFlagsPage from '@/app/(dashboard)/admin/flags/page';

function makeFlag(overrides: Partial<AdminFeatureFlag> = {}): AdminFeatureFlag {
  return {
    key: 'live_auction',
    enabled: true,
    description: 'Real-time descending auction view.',
    rollout_percent: 100,
    binary_only: false,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  useAdminFlagsMock.mockReset();
  toggleMutateAsync.mockReset().mockResolvedValue({
    key: 'k',
    enabled: false,
    rollout_percent: 100,
    binary_only: false,
  });
  useToggleFlagMock
    .mockReset()
    .mockReturnValue({ mutateAsync: toggleMutateAsync, isPending: false });
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminFlagsPage', () => {
  it('shows skeleton loading state while loading', () => {
    useAdminFlagsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(withQueryClient(createElement(AdminFlagsPage)));
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('shows error state when the hook returns isError', () => {
    useAdminFlagsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(withQueryClient(createElement(AdminFlagsPage)));
    expect(screen.getByText('Failed to load feature flags')).toBeInTheDocument();
  });

  it('shows empty state when no flags are returned', () => {
    useAdminFlagsMock.mockReturnValue({
      data: { flags: [] },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminFlagsPage)));
    expect(screen.getByText('No feature flags configured')).toBeInTheDocument();
  });

  it('lists flags grouped into Financial and Platform sections', () => {
    useAdminFlagsMock.mockReturnValue({
      data: {
        flags: [
          makeFlag({ key: 'live_auction', enabled: true, binary_only: false }),
          makeFlag({
            key: 'customer_bnpl',
            enabled: false,
            description: 'Buy now, pay later.',
            binary_only: true,
            rollout_percent: 100,
          }),
        ],
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminFlagsPage)));

    expect(screen.getByRole('region', { name: /financial features/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /platform/i })).toBeInTheDocument();
    expect(screen.getByText('Customer BNPL')).toBeInTheDocument();
    expect(screen.getByText('Live Auction')).toBeInTheDocument();
    // Header summary counts enabled flags.
    expect(screen.getByText('1 of 2 flags enabled')).toBeInTheDocument();
  });

  it('toggling a flag calls the mutation with the inverted enabled state', async () => {
    const user = userEvent.setup();
    useAdminFlagsMock.mockReturnValue({
      data: { flags: [makeFlag({ key: 'live_auction', enabled: true })] },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminFlagsPage)));

    await user.click(screen.getByRole('switch', { name: /toggle live auction/i }));

    expect(toggleMutateAsync).toHaveBeenCalledWith({ key: 'live_auction', enabled: false });
  });

  it('shows a success toast after a successful toggle', async () => {
    const user = userEvent.setup();
    useAdminFlagsMock.mockReturnValue({
      data: {
        flags: [
          makeFlag({
            key: 'customer_bnpl',
            enabled: false,
            binary_only: true,
          }),
        ],
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminFlagsPage)));

    await user.click(screen.getByRole('switch', { name: /toggle customer bnpl/i }));

    // mutateAsync resolves -> success toast fires (microtask).
    await Promise.resolve();
    expect(toggleMutateAsync).toHaveBeenCalledWith({ key: 'customer_bnpl', enabled: true });
    expect(toastSuccess).toHaveBeenCalledWith('Customer BNPL enabled');
  });

  it('disables switches while a toggle is pending', () => {
    useToggleFlagMock.mockReturnValue({ mutateAsync: toggleMutateAsync, isPending: true });
    useAdminFlagsMock.mockReturnValue({
      data: { flags: [makeFlag({ key: 'live_auction', enabled: true })] },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminFlagsPage)));

    expect(screen.getByRole('switch', { name: /toggle live auction/i })).toBeDisabled();
  });

  it('shows sticky rollout controls for non-money flags', () => {
    useAdminFlagsMock.mockReturnValue({
      data: {
        flags: [
          makeFlag({
            key: 'smart_matching',
            enabled: true,
            rollout_percent: 25,
            binary_only: false,
          }),
        ],
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminFlagsPage)));

    expect(
      screen.getByRole('slider', { name: /rollout percent for smart matching/i }),
    ).toHaveAttribute('aria-valuenow', '25');
    expect(
      screen.getByRole('spinbutton', { name: /rollout percent input for smart matching/i }),
    ).toHaveValue(25);
    expect(screen.getByText(/partial rollout active at/i)).toBeInTheDocument();
  });

  it('shows Binary only badge and no % slider for money flags', () => {
    useAdminFlagsMock.mockReturnValue({
      data: {
        flags: [
          makeFlag({
            key: 'instant_payout',
            enabled: true,
            binary_only: true,
            rollout_percent: 100,
          }),
        ],
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminFlagsPage)));

    expect(screen.getByText('Binary only')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(
      screen.getByText(/sticky partial rollout is not available/i),
    ).toBeInTheDocument();
  });

  it('applying rollout percent calls mutation with enabled + rollout_percent', async () => {
    const user = userEvent.setup();
    useAdminFlagsMock.mockReturnValue({
      data: {
        flags: [
          makeFlag({
            key: 'live_auction',
            enabled: true,
            rollout_percent: 100,
            binary_only: false,
          }),
        ],
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminFlagsPage)));

    const input = screen.getByRole('spinbutton', {
      name: /rollout percent input for live auction/i,
    });
    await user.clear(input);
    await user.type(input, '40');

    const apply = screen.getByRole('button', { name: /^apply$/i });
    expect(apply).toBeEnabled();
    await user.click(apply);

    await waitFor(() => {
      expect(toggleMutateAsync).toHaveBeenCalledWith({
        key: 'live_auction',
        enabled: true,
        rollout_percent: 40,
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith('Live Auction rollout set to 40%');
  });
});
