import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaymentOutcome } from '@/lib/payment-outcome';

// MOCKED: gateway api + PaymentConfirmation. PROVEN: customer-only pay CTAs,
// provider complete, approve visit, payment_retry display, server amount labels.

const { get, post } = vi.hoisted(() => ({
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  post: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

class FakeApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API error ${String(status)}`);
  }
  userMessage(fallback: string): string {
    return this.body || fallback;
  }
}

vi.mock('@/lib/api', () => ({
  api: { get, post },
  idempotencyHeader: () => ({ 'Idempotency-Key': 'test-key' }),
  clearIdempotencyKey: vi.fn(),
  getApiErrorMessage: (err: unknown, fb: string) =>
    err instanceof FakeApiError ? err.userMessage(fb) : fb,
  ApiError: FakeApiError,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

let capturedOnOutcome: ((outcome: PaymentOutcome) => void) | null = null;
vi.mock('@/components/payments/PaymentConfirmation', () => ({
  PaymentConfirmation: (props: {
    onOutcome: (outcome: PaymentOutcome) => void;
    submitLabel: string;
  }) => {
    capturedOnOutcome = props.onOutcome;
    return createElement(
      'div',
      { 'data-testid': 'payment-confirmation' },
      props.submitLabel,
    );
  },
}));

const { RecurringSchedule } = await import('@/components/contracts/RecurringSchedule');

const REAL_PI = ['pi', '3Test', 'secret', 'xyz'].join('_');

const CONFIG = {
  id: 'rec-1',
  contract_id: 'contract-1',
  frequency: 'weekly',
  rate_cents: 12000,
  auto_approve: false,
  status: 'active',
  next_occurrence: '2026-08-01T00:00:00Z',
  payment_retry_count: 2,
  payment_retry_threshold: 3,
  next_retry_at: '2026-07-30T15:00:00Z',
};

const INSTANCE_SCHEDULED = {
  id: 'inst-sched',
  recurring_id: 'rec-1',
  occurrence_date: '2026-07-20T00:00:00Z',
  status: 'scheduled',
  amount_cents: 12000,
  auto_approved: false,
};

const INSTANCE_COMPLETED = {
  id: 'inst-done',
  recurring_id: 'rec-1',
  occurrence_date: '2026-07-13T00:00:00Z',
  status: 'completed',
  amount_cents: 12000,
  auto_approved: false,
  completed_at: '2026-07-13T18:00:00Z',
};

const INSTANCE_AUTO = {
  id: 'inst-auto',
  recurring_id: 'rec-1',
  occurrence_date: '2026-07-06T00:00:00Z',
  status: 'completed',
  amount_cents: 9500,
  auto_approved: true,
  completed_at: '2026-07-06T18:00:00Z',
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

function mockHappyPath(instances = [INSTANCE_SCHEDULED, INSTANCE_COMPLETED, INSTANCE_AUTO]) {
  get.mockImplementation(async (path: unknown) => {
    const p = String(path);
    if (p.includes('/recurring/instances')) {
      return { instances };
    }
    if (p.includes('/recurring')) {
      return { config: CONFIG };
    }
    return {};
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  capturedOnOutcome = null;
  mockHappyPath();
});

describe('RecurringSchedule', () => {
  it('renders config, payment retries, and hides when no config', async () => {
    render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: true,
        isProvider: false,
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByTestId('recurring-schedule')).toBeDefined();
    });
    expect(screen.getByText(/Payment retries/i)).toBeDefined();
    expect(screen.getByText(/2 of 3/)).toBeDefined();
    expect(screen.getByText(/Next auto-retry/i)).toBeDefined();
    expect(screen.getByText(/Weekly/i)).toBeDefined();
  });

  it('returns null when gateway has no recurring config', async () => {
    get.mockRejectedValue(new FakeApiError(404, '{"error":"not found"}'));
    const { container } = render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: true,
        isProvider: false,
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(get).toHaveBeenCalled();
    });
    expect(container.querySelector('[data-testid="recurring-schedule"]')).toBeNull();
  });

  it('shows provider Mark visit complete for scheduled instance only', async () => {
    render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: false,
        isProvider: true,
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getByText(/Mark visit complete/i)).toBeDefined();
    });
    // Customer-only CTAs absent for provider
    expect(screen.queryByText(/Approve visit/i)).toBeNull();
    expect(screen.queryByText(/Pay visit/i)).toBeNull();
  });

  it('shows customer Approve visit and Pay visit for auto-approved (no provider CTAs)', async () => {
    render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: true,
        isProvider: false,
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getByText(/Approve visit/i)).toBeDefined();
    });
    // Auto-approved completed visit → Pay visit residual
    expect(screen.getByRole('button', { name: /Pay visit/i })).toBeDefined();
    expect(screen.queryByText(/Mark visit complete/i)).toBeNull();
  });

  it('approve visit posts to approve and surfaces PaymentElement on client_secret', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      instance: { ...INSTANCE_COMPLETED, status: 'completed' },
      payment_id: 'pay-99',
      client_secret: REAL_PI,
    });

    render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: true,
        isProvider: false,
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText(/Approve visit/i)).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: /Approve visit/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/recurring/instances/inst-done/approve'),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('payment-confirmation')).toBeDefined();
    });
    expect(screen.getByTestId('payment-confirmation').textContent).toMatch(/Pay visit/i);
  });

  it('Pay visit for auto-approved uses server amount_cents and recurring_instance_id', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      id: 'pay-new',
      client_secret: REAL_PI,
      amount_cents: 9500,
      status: 'pending',
    });

    render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: true,
        isProvider: false,
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pay visit/i })).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: /Pay visit/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/api/v1/payments',
        expect.objectContaining({
          contract_id: 'contract-1',
          amount_cents: 9500,
          recurring_instance_id: 'inst-auto',
        }),
        expect.any(Object),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('payment-confirmation')).toBeDefined();
    });
  });

  it('settled PaymentElement outcome calls process with empty payment_method_id', async () => {
    const user = userEvent.setup();
    post
      .mockResolvedValueOnce({
        instance: { ...INSTANCE_COMPLETED },
        payment_id: 'pay-99',
        client_secret: REAL_PI,
      })
      .mockResolvedValueOnce({
        id: 'pay-99',
        status: 'escrow',
        amount_cents: 12000,
      });

    render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: true,
        isProvider: false,
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText(/Approve visit/i)).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: /Approve visit/i }));
    await waitFor(() => {
      expect(capturedOnOutcome).not.toBeNull();
    });

    // Manual-capture PI: confirm leaves requires_capture → processing/not settled.
    capturedOnOutcome?.({
      kind: 'processing',
      settled: false,
      message: 'Payment is processing.',
      paymentIntentId: 'pi_x',
      retryable: false,
    });

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/api/v1/payments/pay-99/process',
        { payment_method_id: '' },
        expect.any(Object),
      );
    });
  });

  it('does not show Pay visit to provider for auto-approved visits', async () => {
    mockHappyPath([INSTANCE_AUTO]);
    render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: false,
        isProvider: true,
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getByTestId('recurring-schedule')).toBeDefined();
    });
    expect(screen.queryByRole('button', { name: /Pay visit/i })).toBeNull();
  });
  it('shows FR-18.7 repost CTA for customer when schedule is cancelled', async () => {
    get.mockImplementation(async (path: unknown) => {
      const p = String(path);
      if (p.includes('/recurring/instances')) {
        return { instances: [INSTANCE_COMPLETED] };
      }
      if (p.includes('/recurring')) {
        return { config: { ...CONFIG, status: 'cancelled' } };
      }
      return {};
    });
    render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: true,
        isProvider: false,
        jobTitle: 'Weekly lawn care service',
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getByTestId('recurring-repost-cta')).toBeDefined();
    });
    const link = screen.getByRole('link', { name: /Post a new job for remaining visits/i });
    expect(link.getAttribute('href')).toContain('/jobs/new');
    expect(link.getAttribute('href')).toContain('is_recurring=true');
    expect(link.getAttribute('href')).toContain('recurrence_frequency=weekly');
    expect(link.getAttribute('href')).toMatch(/title=Weekly(\+|%20)lawn(\+|%20)care(\+|%20)service/);
  });

  it('hides FR-18.7 repost CTA from provider when cancelled', async () => {
    get.mockImplementation(async (path: unknown) => {
      const p = String(path);
      if (p.includes('/recurring/instances')) {
        return { instances: [] };
      }
      if (p.includes('/recurring')) {
        return { config: { ...CONFIG, status: 'cancelled' } };
      }
      return {};
    });
    render(
      createElement(RecurringSchedule, {
        contractId: 'contract-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        isCustomer: false,
        isProvider: true,
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getByTestId('recurring-schedule')).toBeDefined();
    });
    expect(screen.queryByTestId('recurring-repost-cta')).toBeNull();
  });

});
