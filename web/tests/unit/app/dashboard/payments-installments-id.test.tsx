// Tests for the installment plan detail page — exercises loading, error, and
// data-rendered states (covering each scheduled-installment status icon).
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const planState: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: true,
  isError: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/payments/installments/abc',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'plan-1' }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useInstallments', () => ({
  useInstallmentPlan: () => planState,
}));

import InstallmentDetailPage from '@/app/(dashboard)/payments/installments/[id]/page';

beforeEach(() => {
  planState.data = undefined;
  planState.isLoading = true;
  planState.isError = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InstallmentDetailPage', () => {
  it('renders without throwing in loading state', () => {
    const { container } = render(withQueryClient(createElement(InstallmentDetailPage)));
    expect(container).toBeTruthy();
  });

  it('shows the error state when isError is true', () => {
    planState.isLoading = false;
    planState.isError = true;
    render(withQueryClient(createElement(InstallmentDetailPage)));
    expect(screen.getByText(/Failed to load payment plan/i)).toBeDefined();
  });

  it('renders plan overview with all five installment statuses', () => {
    planState.isLoading = false;
    planState.isError = false;
    planState.data = {
      plan: {
        id: 'p1',
        status: 'active',
        installment_count: 5,
        per_installment_cents: 10000,
        total_amount_cents: 50000,
        bnpl_fee_cents: 1500,
        total_with_fee_cents: 51500,
        fee_rate: 0.03,
        provider_paid_at: '2026-04-01T00:00:00Z',
        installments: [
          { id: 'i1', installment_number: 1, status: 'paid', amount_cents: 10000, due_date: '2026-04-01T00:00:00Z', paid_at: '2026-04-01T00:00:00Z' },
          { id: 'i2', installment_number: 2, status: 'processing', amount_cents: 10000, due_date: '2026-05-01T00:00:00Z', paid_at: null },
          { id: 'i3', installment_number: 3, status: 'failed', amount_cents: 10000, due_date: '2026-06-01T00:00:00Z', paid_at: null },
          { id: 'i4', installment_number: 4, status: 'retrying', amount_cents: 10000, due_date: '2026-07-01T00:00:00Z', paid_at: null },
          { id: 'i5', installment_number: 5, status: 'scheduled', amount_cents: 10000, due_date: '2026-08-01T00:00:00Z', paid_at: null },
        ],
      },
    };
    render(withQueryClient(createElement(InstallmentDetailPage)));
    expect(screen.getByText('Payment Plan')).toBeDefined();
    expect(screen.getByText(/Plan Overview/)).toBeDefined();
    expect(screen.getByText(/Provider paid on/)).toBeDefined();
    // Progress bar: 1 of 5 paid = 20%.
    expect(screen.getByRole('progressbar', { name: /Payment progress/i })).toBeDefined();
    // 5 installment rows render.
    expect(screen.getAllByText(/^Payment \d$/).length).toBe(5);
  });

  it('renders cancelled plan status badge', () => {
    planState.isLoading = false;
    planState.isError = false;
    planState.data = {
      plan: {
        id: 'p2',
        status: 'cancelled',
        installment_count: 0,
        per_installment_cents: 0,
        total_amount_cents: 0,
        bnpl_fee_cents: 0,
        total_with_fee_cents: 0,
        fee_rate: 0.03,
        provider_paid_at: null,
        installments: [],
      },
    };
    render(withQueryClient(createElement(InstallmentDetailPage)));
    expect(screen.getByText('Cancelled')).toBeDefined();
  });

  it('renders defaulted plan status badge', () => {
    planState.isLoading = false;
    planState.isError = false;
    planState.data = {
      plan: {
        id: 'p3',
        status: 'defaulted',
        installment_count: 1,
        per_installment_cents: 5000,
        total_amount_cents: 5000,
        bnpl_fee_cents: 100,
        total_with_fee_cents: 5100,
        fee_rate: 0.02,
        provider_paid_at: null,
        installments: [
          { id: 'i1', installment_number: 1, status: 'failed', amount_cents: 5000, due_date: '2026-03-01T00:00:00Z', paid_at: null },
        ],
      },
    };
    render(withQueryClient(createElement(InstallmentDetailPage)));
    expect(screen.getByText('Defaulted')).toBeDefined();
  });
});
