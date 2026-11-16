import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ContractCard,
  getStatusVariant,
  TipWidget,
} from '@/components/contracts/ContractCard';
import type { Contract } from '@/types';

// MOCKED: `@/lib/api` and sonner. PROVEN: the tip failure path keeps the
// composer open for a retry, a card click never navigates when the tip control
// is used, and the status → badge-variant map the detail page relies on.

const { post, toastError, toastSuccess, clearIdempotencyKey } = vi.hoisted(() => ({
  post: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  clearIdempotencyKey: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { post },
  getApiErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback,
  ApiError: class ApiError extends Error {},
  idempotencyHeader: (op?: string) => ({ 'Idempotency-Key': op ?? 'test-key' }),
  clearIdempotencyKey,
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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

beforeEach(() => {
  post.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  clearIdempotencyKey.mockReset();
});

describe('getStatusVariant', () => {
  it.each([
    ['active', 'default'],
    ['completed', 'default'],
    ['pending_acceptance', 'secondary'],
    ['cancelled', 'destructive'],
    ['voided', 'destructive'],
    ['abandoned', 'destructive'],
    ['disputed', 'outline'],
    ['suspended', 'outline'],
    ['something_new', 'outline'],
  ])('maps %s to the %s badge', (status, variant) => {
    expect(getStatusVariant(status)).toBe(variant);
  });
});

describe('TipWidget — failures and retries', () => {
  it('keeps the composer open with the server reason when the charge fails', async () => {
    post.mockRejectedValueOnce(new Error('Your card was declined.'));
    const user = userEvent.setup();
    renderWithClient(<TipWidget contractId="c-1" suggestedAmountCents={10000} />);

    await user.click(screen.getByRole('button', { name: /tip your provider/i }));
    await user.click(screen.getByRole('button', { name: /20% — \$20\.00/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(toastError).toHaveBeenCalledWith('Your card was declined.');
    expect(toastSuccess).not.toHaveBeenCalled();
    // The sticky idempotency key survives a failure so a retry cannot double-charge.
    expect(clearIdempotencyKey).not.toHaveBeenCalled();
    expect(screen.queryByText(/your tip is on its way/i)).toBeNull();
    expect(screen.getByRole('group', { name: 'Tip composer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /20% — \$20\.00/ })).toBeEnabled();
  });

  it('clears the error and succeeds on a retry, releasing the idempotency key', async () => {
    post.mockRejectedValueOnce(new Error('Your card was declined.'));
    post.mockResolvedValueOnce({ tip_amount_cents: 1000 });
    const user = userEvent.setup();
    renderWithClient(<TipWidget contractId="c-1" suggestedAmountCents={10000} />);

    await user.click(screen.getByRole('button', { name: /tip your provider/i }));
    await user.click(screen.getByRole('button', { name: /10% — \$10\.00/ }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: /10% — \$10\.00/ }));

    expect(await screen.findByText(/your tip is on its way/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
    expect(clearIdempotencyKey).toHaveBeenCalledWith('tip:c-1');
    expect(toastSuccess).toHaveBeenCalledWith(
      'Tip sent — $10.00 on its way to your provider. Thank you!',
    );
  });

  it('locks every control while the tip is being charged', async () => {
    let settle: (value: unknown) => void = () => undefined;
    post.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithClient(<TipWidget contractId="c-1" suggestedAmountCents={10000} />);

    await user.click(screen.getByRole('button', { name: /tip your provider/i }));
    await user.type(screen.getByLabelText(/custom tip amount/i), '7.25');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));

    expect(screen.getByRole('button', { name: '...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /10% — \$10\.00/ })).toBeDisabled();
    expect(screen.getByLabelText(/custom tip amount/i)).toBeDisabled();
    expect(post).toHaveBeenCalledWith(
      '/api/v1/contracts/c-1/tip',
      { amount_cents: 725 },
      { 'Idempotency-Key': 'tip:c-1' },
    );

    settle({ tip_amount_cents: 725 });
    await waitFor(() => {
      expect(screen.getByText(/your tip is on its way/i)).toBeInTheDocument();
    });
  });

  it('keeps Send disabled until a custom amount is typed', async () => {
    const user = userEvent.setup();
    renderWithClient(<TipWidget contractId="c-1" suggestedAmountCents={10000} />);
    await user.click(screen.getByRole('button', { name: /tip your provider/i }));

    expect(screen.getByRole('button', { name: /^Send$/ })).toBeDisabled();
    await user.type(screen.getByLabelText(/custom tip amount/i), '5');
    expect(screen.getByRole('button', { name: /^Send$/ })).toBeEnabled();
  });

  it('rejects a preset under $1 on a small contract', async () => {
    const user = userEvent.setup();
    // 10% of $5.00 is $0.50.
    renderWithClient(<TipWidget contractId="c-1" suggestedAmountCents={500} />);
    await user.click(screen.getByRole('button', { name: /tip your provider/i }));
    await user.click(screen.getByRole('button', { name: /10% — \$0\.50/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Tip must be at least $1.');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('ContractCard — tip control inside the card link', () => {
  it('opens the composer without following the card link', async () => {
    const user = userEvent.setup();
    renderWithClient(<ContractCard contract={makeContract({ status: 'completed' })} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/contracts/c-1');
    // The click bubbles through the anchor; once dispatch finishes, the tip
    // control must have cancelled the anchor's default action (navigation).
    const seen: MouseEvent[] = [];
    link.addEventListener('click', (event) => {
      seen.push(event);
    });

    await user.click(screen.getByRole('button', { name: /tip your provider/i }));

    expect(screen.getByRole('group', { name: 'Tip composer' })).toBeInTheDocument();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.defaultPrevented).toBe(true);
  });
});
