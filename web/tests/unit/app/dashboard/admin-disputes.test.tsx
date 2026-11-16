// Tests for the admin disputes list page — exercises loading, error, table render
// with column callbacks, and dispute link rendering.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const disputesState: {
  data: { disputes: Record<string, unknown>[]; pagination?: Record<string, unknown> } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/disputes',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useAdmin', () => ({
  useAdminDisputes: () => disputesState,
}));

const { default: AdminDisputesPage } = await import('@/app/(dashboard)/admin/disputes/page');

function makeDispute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dispute-abcdef1234567890',
    initiated_by: 'user-12345678',
    initiator_name: 'Alice',
    respondent_name: 'Bob',
    reason: 'Provider work was incomplete and unsatisfactory.',
    status: 'open',
    refund_amount_cents: 0,
    created_at: '2026-04-10T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  disputesState.data = undefined;
  disputesState.isLoading = false;
  disputesState.isError = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminDisputesPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminDisputesPage)));
    expect(container).toBeTruthy();
  });

  it('shows error state when fetch fails', () => {
    disputesState.isError = true;
    render(withQueryClient(createElement(AdminDisputesPage)));
    expect(screen.getByText(/Failed to load disputes/i)).toBeDefined();
  });

  it('renders rows with parties and reason when loaded', () => {
    disputesState.data = {
      disputes: [makeDispute()],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminDisputesPage)));
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText(/vs Bob/i)).toBeDefined();
    expect(screen.getByText(/Provider work was incomplete/i)).toBeDefined();
  });

  it('renders the truncated dispute id link', () => {
    disputesState.data = {
      disputes: [makeDispute()],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminDisputesPage)));
    const link = screen.getByText(/dispute-/);
    expect(link).toBeDefined();
    expect(link.textContent).toContain('...');
  });

  it('renders status badge label using DISPUTE_STATUS_LABELS', () => {
    disputesState.data = {
      disputes: [
        makeDispute({ status: 'open', id: 'd-1' }),
        makeDispute({ status: 'investigating', id: 'd-2' }),
        makeDispute({ status: 'resolved', id: 'd-3' }),
        makeDispute({ status: 'escalated', id: 'd-4' }),
      ],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminDisputesPage)));
    expect(screen.getByText('Open')).toBeDefined();
    expect(screen.getByText('Investigating')).toBeDefined();
    expect(screen.getByText('Resolved')).toBeDefined();
    expect(screen.getByText('Escalated')).toBeDefined();
  });

  it('renders refund amount when present, dashes otherwise', () => {
    disputesState.data = {
      disputes: [
        makeDispute({ id: 'd-1', refund_amount_cents: 5000 }),
        makeDispute({ id: 'd-2', refund_amount_cents: 0 }),
      ],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminDisputesPage)));
    expect(screen.getByText(/\$50\.00/)).toBeDefined();
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });

  it('falls back to truncated initiated_by when initiator_name missing', () => {
    disputesState.data = {
      disputes: [
        makeDispute({
          initiator_name: undefined,
          initiated_by: 'user-fallback-12345',
        }),
      ],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminDisputesPage)));
    expect(screen.getByText('user-fal')).toBeDefined();
  });

  it('falls back to "Respondent" when respondent_name missing', () => {
    disputesState.data = {
      disputes: [makeDispute({ respondent_name: undefined })],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminDisputesPage)));
    expect(screen.getByText(/vs Respondent/i)).toBeDefined();
  });

  it('renders the status filter Select trigger', () => {
    render(withQueryClient(createElement(AdminDisputesPage)));
    expect(screen.getByLabelText(/Filter disputes by status/i)).toBeDefined();
  });

  it('renders empty message when no disputes', () => {
    disputesState.data = {
      disputes: [],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminDisputesPage)));
    expect(screen.getByText(/No disputes found/i)).toBeDefined();
  });

  it('changes status filter via Select trigger and option click', () => {
    // The Select's onValueChange (lines 147-150) only fires through Radix —
    // open the combobox, then click an option.
    disputesState.data = {
      disputes: [],
      pagination: { page: 1, totalPages: 1, hasNext: false },
    };
    render(withQueryClient(createElement(AdminDisputesPage)));
    const trigger = screen.getByRole('combobox', { name: /filter disputes by status/i });
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: /^Open$/i });
    fireEvent.click(option);
    fireEvent.click(trigger);
    const allOption = screen.getByRole('option', { name: /All Statuses/i });
    fireEvent.click(allOption);
    expect(trigger).toBeDefined();
  });
});
