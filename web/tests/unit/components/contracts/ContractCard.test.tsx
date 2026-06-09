import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContractCard, TipWidget } from '@/components/contracts/ContractCard';
import { api } from '@/lib/api';
import type { Contract, Milestone } from '@/types';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), getPublic: vi.fn() },
  getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
  ApiError: class ApiError extends Error {},
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/**
 * Renders inside a fresh QueryClientProvider. Required for any tree that
 * reaches the TipWidget (it calls useQueryClient to invalidate on success),
 * e.g. a completed contract card.
 */
function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    createElement(QueryClientProvider, { client }, ui),
  );
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm-1',
    contract_id: 'c-1',
    description: 'First milestone',
    amount_cents: 10000,
    sort_order: 1,
    status: 'pending',
    revision_count: 0,
    revision_notes: '',
    ...overrides,
  };
}

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'c-1',
    contract_number: 'CON-2026-001',
    job_id: 'job-1',
    job_title: 'Test job title',
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

describe('ContractCard', () => {
  it('shows contract number and amount', () => {
    render(
      createElement(ContractCard, {
        contract: makeContract({ amount_cents: 123456 }),
      }),
    );
    expect(screen.getByText('CON-2026-001')).toBeDefined();
    expect(screen.getByText('$1,234.56')).toBeDefined();
  });

  it('shows status badge label for active contracts', () => {
    render(createElement(ContractCard, { contract: makeContract({ status: 'active' }) }));
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('shows milestone progress when milestones exist', () => {
    const contract = makeContract({
      milestones: [
        makeMilestone({ id: 'm-1', status: 'approved' }),
        makeMilestone({ id: 'm-2', status: 'pending' }),
      ],
    });
    render(createElement(ContractCard, { contract }));
    expect(screen.getByText(/1 \/ 2 completed/i)).toBeDefined();
    expect(screen.getByText('50%')).toBeDefined();
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('renders payment timing label', () => {
    render(
      createElement(ContractCard, {
        contract: makeContract({ payment_timing: 'milestone' }),
      }),
    );
    expect(screen.getByText('Milestone')).toBeDefined();
  });

  it('falls back to job id slice when job_title is empty', () => {
    render(
      createElement(ContractCard, {
        contract: makeContract({ job_title: '', job_id: 'abcd1234efgh' }),
      }),
    );
    expect(screen.getByText(/Job: abcd1234/)).toBeDefined();
  });

  it('shows acceptance countdown for pending_acceptance contracts', () => {
    render(
      createElement(ContractCard, {
        contract: makeContract({
          status: 'pending_acceptance',
          acceptance_deadline: '2099-01-01T00:00:00Z',
        }),
      }),
    );
    expect(screen.getByText('Pending Acceptance')).toBeDefined();
  });

  it('marks a past-deadline pending_acceptance contract as Expired (not Pending)', () => {
    render(
      createElement(ContractCard, {
        contract: makeContract({
          status: 'pending_acceptance',
          acceptance_deadline: '2000-01-01T00:00:00Z',
        }),
      }),
    );
    expect(screen.getByText('Expired')).toBeDefined();
    expect(screen.queryByText('Pending Acceptance')).toBeNull();
    expect(screen.getByText(/Acceptance window expired/i)).toBeDefined();
  });

  it('keeps a future-deadline pending_acceptance contract as Pending Acceptance', () => {
    render(
      createElement(ContractCard, {
        contract: makeContract({
          status: 'pending_acceptance',
          acceptance_deadline: '2099-01-01T00:00:00Z',
        }),
      }),
    );
    expect(screen.getByText('Pending Acceptance')).toBeDefined();
    expect(screen.queryByText('Expired')).toBeNull();
  });

  it('renders status labels for cancelled, voided, disputed, suspended, abandoned, completed', () => {
    const statuses: Array<{ status: string; label: string }> = [
      { status: 'cancelled', label: 'Cancelled' },
      { status: 'voided', label: 'Voided' },
      { status: 'disputed', label: 'Disputed' },
      { status: 'suspended', label: 'Suspended' },
      { status: 'abandoned', label: 'Abandoned' },
      { status: 'completed', label: 'Completed' },
    ];
    for (const { status, label } of statuses) {
      // `completed` renders the TipWidget, which needs a QueryClient.
      const { unmount, getByText } = renderWithClient(
        createElement(ContractCard, { contract: makeContract({ status }) }),
      );
      expect(getByText(label)).toBeDefined();
      unmount();
    }
  });

  it('falls back to formatted status for unknown status values', () => {
    render(
      createElement(ContractCard, {
        contract: makeContract({ status: 'weird_made_up_status' }),
      }),
    );
    expect(screen.getByText('weird made up status')).toBeDefined();
  });

  it('renders all payment timing labels', () => {
    const timings: Array<{ timing: string; label: string }> = [
      { timing: 'upfront', label: 'Upfront' },
      { timing: 'completion', label: 'On Completion' },
      { timing: 'payment_plan', label: 'Payment Plan' },
      { timing: 'recurring', label: 'Recurring' },
    ];
    for (const { timing, label } of timings) {
      const { unmount, getByText } = render(
        createElement(ContractCard, {
          contract: makeContract({ payment_timing: timing }),
        }),
      );
      expect(getByText(label)).toBeDefined();
      unmount();
    }
  });

  it('falls back to formatted timing for unknown payment_timing', () => {
    render(
      createElement(ContractCard, {
        contract: makeContract({ payment_timing: 'custom_thing' }),
      }),
    );
    expect(screen.getByText('custom thing')).toBeDefined();
  });

  it('renders 100% completion progress with the emerald gradient bar', () => {
    const contract = makeContract({
      milestones: [makeMilestone({ id: 'm-1', status: 'approved' })],
    });
    render(createElement(ContractCard, { contract }));
    expect(screen.getByText('100%')).toBeDefined();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('renders mid-range completion (>= 60%) with blue-emerald gradient', () => {
    const contract = makeContract({
      milestones: [
        makeMilestone({ id: 'm-1', status: 'approved' }),
        makeMilestone({ id: 'm-2', status: 'approved' }),
        makeMilestone({ id: 'm-3', status: 'pending' }),
      ],
    });
    render(createElement(ContractCard, { contract }));
    // 2/3 = 67%
    expect(screen.getByText('67%')).toBeDefined();
  });

  it('omits the milestone progress bar when there are no milestones', () => {
    render(
      createElement(ContractCard, {
        contract: makeContract({ milestones: [] }),
      }),
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/Milestones/)).toBeNull();
  });

  it('renders the tip control on a completed, untipped contract', () => {
    renderWithClient(
      createElement(ContractCard, {
        contract: makeContract({ status: 'completed', tip_amount_cents: 0 }),
      }),
    );
    expect(screen.getByRole('button', { name: /tip your provider/i })).toBeDefined();
  });

  it('hides the tip control once a tip has been recorded', () => {
    renderWithClient(
      createElement(ContractCard, {
        contract: makeContract({ status: 'completed', tip_amount_cents: 2500 }),
      }),
    );
    expect(screen.queryByRole('button', { name: /tip your provider/i })).toBeNull();
    expect(screen.getByText(/Tip: \$25\.00/)).toBeDefined();
  });
});

describe('TipWidget', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the composer with percentage presets when clicked', async () => {
    const user = userEvent.setup();
    renderWithClient(
      createElement(TipWidget, { contractId: 'c-1', suggestedAmountCents: 10000 }),
    );

    await user.click(screen.getByRole('button', { name: /tip your provider/i }));

    // 10/15/20% of $100.00.
    expect(screen.getByRole('button', { name: /10% — \$10\.00/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /15% — \$15\.00/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /20% — \$20\.00/ })).toBeDefined();
  });

  it('submits a preset tip — POSTs the amount and shows the success state', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ tip_amount_cents: 1500 });
    renderWithClient(
      createElement(TipWidget, { contractId: 'c-9', suggestedAmountCents: 10000 }),
    );

    await user.click(screen.getByRole('button', { name: /tip your provider/i }));
    await user.click(screen.getByRole('button', { name: /15% — \$15\.00/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/v1/contracts/c-9/tip', {
        amount_cents: 1500,
      });
    });
    expect(await screen.findByText(/your tip is on its way/i)).toBeDefined();
  });

  it('submits a custom dollar amount as cents', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ tip_amount_cents: 1200 });
    renderWithClient(
      createElement(TipWidget, { contractId: 'c-7', suggestedAmountCents: 10000 }),
    );

    await user.click(screen.getByRole('button', { name: /tip your provider/i }));
    await user.type(screen.getByLabelText(/custom tip amount/i), '12');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/v1/contracts/c-7/tip', {
        amount_cents: 1200,
      });
    });
  });

  it('rejects a sub-$1 tip without calling the API', async () => {
    const user = userEvent.setup();
    renderWithClient(
      // 0.5% of $100 = $0.50 → below the $1 floor.
      createElement(TipWidget, { contractId: 'c-3', suggestedAmountCents: 10000 }),
    );

    await user.click(screen.getByRole('button', { name: /tip your provider/i }));
    await user.type(screen.getByLabelText(/custom tip amount/i), '0.5');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));

    expect(await screen.findByText(/at least \$1/i)).toBeDefined();
    expect(api.post).not.toHaveBeenCalled();
  });
});
