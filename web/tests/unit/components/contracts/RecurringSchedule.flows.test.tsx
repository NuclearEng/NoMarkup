import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaymentOutcome } from '@/lib/payment-outcome';
import type { ContractRecurringConfig, ContractRecurringInstance } from '@/types';

// MOCKED: gateway api, the linked-job hook, sonner and PaymentConfirmation.
// PROVEN: schedule controls (pause / resume / cancel), every money message
// after approve / complete, the dev-secret and PaymentElement capture paths,
// retry and date display edge cases, and the repost deep link.
// NOT PROVEN: gateway behaviour or Stripe confirmation.

const { get, post, patch, clearIdempotencyKey, toast, jobState } = vi.hoisted(() => ({
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  post: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  patch: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  clearIdempotencyKey: vi.fn<(key: string) => void>(),
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
    message: vi.fn<(message: string) => void>(),
  },
  jobState: {
    requestedIds: [] as string[],
    job: undefined as
      | { property_id?: string; category_id?: string; starting_bid_cents?: number }
      | undefined,
  },
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
  api: { get, post, patch },
  idempotencyHeader: (op?: string) => ({ 'Idempotency-Key': op ?? 'test-key' }),
  clearIdempotencyKey,
  getApiErrorMessage: (err: unknown, fb: string) =>
    err instanceof FakeApiError ? err.userMessage(fb) : fb,
  ApiError: FakeApiError,
}));

vi.mock('sonner', () => ({ toast }));

vi.mock('@/hooks/useJobs', () => ({
  useJob: (id: string) => {
    jobState.requestedIds.push(id);
    return { data: id ? jobState.job : undefined };
  },
}));

let capturedOnOutcome: ((outcome: PaymentOutcome) => void) | null = null;
vi.mock('@/components/payments/PaymentConfirmation', () => ({
  PaymentConfirmation: (props: {
    onOutcome: (outcome: PaymentOutcome) => void;
    onCancel: () => void;
    submitLabel: string;
    returnPath: string;
  }) => {
    capturedOnOutcome = props.onOutcome;
    return createElement(
      'div',
      { 'data-testid': 'payment-confirmation', 'data-return-path': props.returnPath },
      createElement('span', null, props.submitLabel),
      createElement('button', { type: 'button', onClick: props.onCancel }, 'Cancel payment'),
    );
  },
}));

const { RecurringSchedule, buildRecurringRepostHref } = await import(
  '@/components/contracts/RecurringSchedule'
);

const REAL_PI = ['pi', '3Test', 'secret', 'xyz'].join('_');
const DEV_SECRET = 'dev_visit_secret';

const BASE_CONFIG: ContractRecurringConfig = {
  id: 'rec-1',
  contract_id: 'contract-1',
  frequency: 'weekly',
  rate_cents: 12000,
  auto_approve: false,
  status: 'active',
};

const SCHEDULED: ContractRecurringInstance = {
  id: 'inst-sched',
  recurring_id: 'rec-1',
  occurrence_date: '2026-07-20T12:00:00Z',
  status: 'scheduled',
  amount_cents: 12000,
  auto_approved: false,
};

const COMPLETED: ContractRecurringInstance = {
  id: 'inst-done',
  recurring_id: 'rec-1',
  occurrence_date: '2026-07-13T12:00:00Z',
  status: 'completed',
  amount_cents: 12000,
  auto_approved: false,
};

const AUTO: ContractRecurringInstance = {
  id: 'inst-auto',
  recurring_id: 'rec-1',
  occurrence_date: '2026-07-06T12:00:00Z',
  status: 'completed',
  amount_cents: 9500,
  auto_approved: true,
};

let currentConfig: ContractRecurringConfig | null = BASE_CONFIG;
let currentInstances: ContractRecurringInstance[] = [];
let configFails = false;
let instancesNeverResolve = false;

type PostHandler = () => Promise<unknown>;

/** Route POSTs by path suffix; anything unrouted rejects so tests fail loudly. */
function routePost(routes: Record<string, PostHandler>): void {
  post.mockImplementation((path: unknown) => {
    const p = String(path);
    for (const [suffix, handler] of Object.entries(routes)) {
      if (p.endsWith(suffix)) return handler();
    }
    return Promise.reject(new Error(`unexpected POST ${p}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

interface RenderOptions {
  role?: 'customer' | 'provider' | 'both' | 'observer';
  embeddedConfig?: ContractRecurringConfig | null;
  jobTitle?: string;
  jobId?: string;
  amountCents?: number;
}

function renderSchedule(options: RenderOptions = {}) {
  const role = options.role ?? 'customer';
  return render(
    createElement(RecurringSchedule, {
      contractId: 'contract-1',
      customerId: 'cust-1',
      providerId: 'prov-1',
      isCustomer: role === 'customer' || role === 'both',
      isProvider: role === 'provider' || role === 'both',
      embeddedConfig: options.embeddedConfig,
      jobTitle: options.jobTitle,
      jobId: options.jobId,
      amountCents: options.amountCents,
    }),
    { wrapper },
  );
}

async function findVisit(id: string): Promise<HTMLElement> {
  return screen.findByTestId(`recurring-instance-${id}`);
}

function outcome(overrides: Partial<PaymentOutcome>): PaymentOutcome {
  return {
    kind: 'succeeded',
    settled: true,
    retryable: false,
    message: 'ok',
    paymentIntentId: 'pi_3Test',
    ...overrides,
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  clearIdempotencyKey.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  toast.message.mockReset();
  jobState.requestedIds = [];
  jobState.job = undefined;
  capturedOnOutcome = null;
  currentConfig = BASE_CONFIG;
  currentInstances = [SCHEDULED, COMPLETED, AUTO];
  configFails = false;
  instancesNeverResolve = false;

  get.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes('/recurring/instances')) {
      if (instancesNeverResolve) return new Promise<never>(() => undefined);
      return Promise.resolve({ instances: currentInstances });
    }
    if (p.includes('/recurring')) {
      if (configFails) return Promise.reject(new FakeApiError(500, 'boom'));
      return Promise.resolve({ config: currentConfig });
    }
    return Promise.resolve({});
  });
  patch.mockImplementation(() => Promise.resolve({ config: currentConfig }));
});

describe('buildRecurringRepostHref', () => {
  function params(href: string): URLSearchParams {
    const [path, query] = href.split('?');
    expect(path).toBe('/jobs/new');
    return new URLSearchParams(query);
  }

  it('always marks the job recurring and carries a description that meets the 50-char minimum', () => {
    const q = params(buildRecurringRepostHref(undefined, undefined));
    expect(q.get('is_recurring')).toBe('true');
    expect((q.get('description') ?? '').length).toBeGreaterThanOrEqual(50);
    expect(q.has('recurrence_frequency')).toBe(false);
    expect(q.has('title')).toBe(false);
    expect(q.has('property_id')).toBe(false);
    expect(q.has('category_id')).toBe(false);
    expect(q.has('starting_bid_cents')).toBe(false);
  });

  it.each(['weekly', 'biweekly', 'monthly', 'quarterly'])('passes the %s frequency', (freq) => {
    const q = params(buildRecurringRepostHref(`  ${freq.toUpperCase()} `, undefined));
    expect(q.get('recurrence_frequency')).toBe(freq);
  });

  it('drops a frequency the job form does not offer', () => {
    expect(params(buildRecurringRepostHref('daily', undefined)).has('recurrence_frequency')).toBe(
      false,
    );
  });

  it('only prefills a title of at least 10 characters and caps it at 200', () => {
    expect(params(buildRecurringRepostHref('weekly', 'Lawn care')).has('title')).toBe(false);
    expect(params(buildRecurringRepostHref('weekly', ' Lawn care! ')).get('title')).toBe(
      'Lawn care!',
    );
    const long = params(buildRecurringRepostHref('weekly', 'a'.repeat(250))).get('title');
    expect(long).toHaveLength(200);
  });

  it('trims ids and ignores blank ones', () => {
    const q = params(
      buildRecurringRepostHref('weekly', undefined, { propertyId: ' prop-1 ', categoryId: '   ' }),
    );
    expect(q.get('property_id')).toBe('prop-1');
    expect(q.has('category_id')).toBe(false);
  });

  it('rounds the starting bid to integer cents and omits non-positive or non-finite bids', () => {
    const bid = (cents: number | null) =>
      params(buildRecurringRepostHref('weekly', undefined, { startingBidCents: cents })).get(
        'starting_bid_cents',
      );
    expect(bid(12345.6)).toBe('12346');
    expect(bid(0)).toBeNull();
    expect(bid(-100)).toBeNull();
    expect(bid(Number.NaN)).toBeNull();
    expect(bid(Number.POSITIVE_INFINITY)).toBeNull();
    expect(bid(null)).toBeNull();
  });
});

describe('RecurringSchedule — config display', () => {
  it('shows the plain explanation and no retry rows when payments have never failed', async () => {
    renderSchedule();
    const card = await screen.findByTestId('recurring-schedule');
    expect(card).toHaveTextContent(/Pause stops new visits/);
    expect(card).not.toHaveTextContent(/Payment setup failed previously/);
    expect(screen.queryByText('Payment retries')).not.toBeInTheDocument();
    expect(screen.queryByText('Next auto-retry')).not.toBeInTheDocument();
    expect(screen.queryByText('Next occurrence')).not.toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByLabelText(/Future rate/)).toHaveAttribute('placeholder', '120');
  });

  it('falls back to $0.00 and an example placeholder when the config has no rate', async () => {
    currentConfig = { id: 'rec-1', status: 'active' };
    currentInstances = [];
    renderSchedule();
    const card = await screen.findByTestId('recurring-schedule');
    expect(within(card).getByText('$0.00')).toBeInTheDocument();
    expect(within(card).getByText('Recurring')).toBeInTheDocument();
    expect(screen.getByLabelText(/Future rate/)).toHaveAttribute('placeholder', 'e.g. 120.00');
  });

  it.each([
    ['a month end', '2026-01-31T12:00:00Z', 'Jan 31, 2026'],
    ['the last day of February', '2026-02-28T12:00:00Z', 'Feb 28, 2026'],
    ['a leap day', '2028-02-29T12:00:00Z', 'Feb 29, 2028'],
    ['a year end', '2026-12-31T12:00:00Z', 'Dec 31, 2026'],
  ])('formats a next occurrence on %s', async (_label, iso, expected) => {
    currentConfig = { ...BASE_CONFIG, next_occurrence: iso };
    currentInstances = [];
    renderSchedule();
    await screen.findByTestId('recurring-schedule');
    expect(screen.getByText('Next occurrence')).toBeInTheDocument();
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('shows an unparseable next occurrence verbatim instead of "Invalid Date"', async () => {
    currentConfig = { ...BASE_CONFIG, next_occurrence: 'next Tuesday' };
    currentInstances = [];
    renderSchedule();
    await screen.findByTestId('recurring-schedule');
    expect(screen.getByText('next Tuesday')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it('warns that the schedule may be paused once retries reach the threshold', async () => {
    currentConfig = { ...BASE_CONFIG, payment_retry_count: 3, payment_retry_threshold: 3 };
    renderSchedule();
    await screen.findByTestId('recurring-schedule');
    expect(screen.getByLabelText('Payment retries 3 of 3')).toHaveClass('text-destructive');
    expect(
      screen.getByText(/Payment setup failed 3 times — the schedule may be paused/),
    ).toBeInTheDocument();
  });

  it('defaults the threshold to 3 and shows retries below it as a warning, not a failure', async () => {
    currentConfig = { ...BASE_CONFIG, payment_retry_count: 1 };
    renderSchedule();
    await screen.findByTestId('recurring-schedule');
    const retries = screen.getByLabelText('Payment retries 1 of 3');
    expect(retries).toHaveClass('text-amber-400');
    expect(screen.queryByText(/the schedule may be paused/)).not.toBeInTheDocument();
    expect(screen.queryByText('Next auto-retry')).not.toBeInTheDocument();
  });

  it('shows only the next auto-retry time when a retry is scheduled but none has failed yet', async () => {
    currentConfig = { ...BASE_CONFIG, next_retry_at: '2026-07-30T12:00:00Z' };
    renderSchedule();
    const card = await screen.findByTestId('recurring-schedule');
    expect(card).toHaveTextContent(/Payment setup failed previously/);
    expect(screen.getByText('Next auto-retry')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Next automatic payment retry Jul 30, 2026/)).toBeInTheDocument();
    expect(screen.queryByText('Payment retries')).not.toBeInTheDocument();
  });

  it('shows an unparseable retry time verbatim', async () => {
    currentConfig = { ...BASE_CONFIG, next_retry_at: 'soon' };
    renderSchedule();
    await screen.findByTestId('recurring-schedule');
    expect(screen.getByLabelText('Next automatic payment retry soon')).toHaveTextContent('soon');
  });

  it('renders the embedded config immediately and keeps it when the config fetch fails', async () => {
    configFails = true;
    renderSchedule({ embeddedConfig: { ...BASE_CONFIG, frequency: 'monthly', status: 'paused' } });
    // Synchronous: the seed is shown before any request settles.
    expect(screen.getByTestId('recurring-schedule')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    await findVisit('inst-sched');
    expect(screen.getByText('Monthly')).toBeInTheDocument();
  });

  it('renders nothing while the first config fetch is pending and there is no seed', () => {
    const { container } = renderSchedule();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the gateway reports no config and the seed has no id', async () => {
    currentConfig = null;
    const { container } = renderSchedule({ embeddedConfig: null });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/api/v1/contracts/contract-1/recurring');
    });
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining('/recurring/instances'));
  });
});

describe('RecurringSchedule — visit list', () => {
  it('shows skeletons while visits load', async () => {
    instancesNeverResolve = true;
    renderSchedule();
    expect(await screen.findByTestId('recurring-instances-loading')).toBeInTheDocument();
  });

  it('explains when there are no occurrences yet', async () => {
    currentInstances = [];
    renderSchedule();
    expect(await screen.findByText(/No occurrences yet/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders a single occurrence with its date, status and server amount', async () => {
    currentInstances = [SCHEDULED];
    renderSchedule();
    const visit = await findVisit('inst-sched');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(visit).toHaveTextContent('Jul 20, 2026');
    expect(visit).toHaveTextContent('Scheduled');
    expect(visit).toHaveTextContent('$120.00');
    expect(within(visit).queryByRole('button')).not.toBeInTheDocument();
  });

  it('labels approval and payment state per visit', async () => {
    currentInstances = [
      AUTO,
      { ...COMPLETED, id: 'inst-approved', approved_at: '2026-07-14T09:00:00Z' },
      { ...COMPLETED, id: 'inst-funded', approved_at: '2026-07-14T09:00:00Z', payment_funded: true },
      { ...COMPLETED, id: 'inst-pending', payment_status: 'requires_action' },
      { id: 'inst-bare' },
      { ...SCHEDULED, id: 'inst-baddate', occurrence_date: 'tbd', status: 'in_progress' },
    ];
    renderSchedule();
    expect(await findVisit('inst-auto')).toHaveTextContent('Completed · Auto-approved');
    expect(screen.getByTestId('recurring-instance-inst-approved')).toHaveTextContent(
      'Completed · Approved',
    );
    const funded = screen.getByTestId('recurring-instance-inst-funded');
    expect(funded).toHaveTextContent('Completed · Approved · Escrow funded');
    expect(within(funded).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('recurring-instance-inst-pending')).toHaveTextContent(
      'Completed · Payment Requires Action',
    );
    const bare = screen.getByTestId('recurring-instance-inst-bare');
    expect(bare).toHaveTextContent('—');
    expect(bare).toHaveTextContent('Unknown');
    expect(bare).toHaveTextContent('$0.00');
    expect(within(bare).queryByRole('button')).not.toBeInTheDocument();
    const badDate = screen.getByTestId('recurring-instance-inst-baddate');
    expect(badDate).toHaveTextContent('tbd');
    expect(badDate).toHaveTextContent('In Progress');
  });

  it('never offers Pay for a completed visit with no server amount', async () => {
    currentInstances = [{ ...AUTO, amount_cents: 0 }];
    renderSchedule();
    const visit = await findVisit('inst-auto');
    expect(within(visit).queryByRole('button', { name: /Pay visit/ })).not.toBeInTheDocument();
  });

  it('lets the provider complete an in-progress visit', async () => {
    currentInstances = [{ ...SCHEDULED, status: 'in_progress' }];
    renderSchedule({ role: 'provider' });
    const visit = await findVisit('inst-sched');
    expect(within(visit).getByRole('button', { name: 'Mark visit complete' })).toBeEnabled();
  });
});

describe('RecurringSchedule — schedule controls', () => {
  it('pauses an active schedule and then offers Resume', async () => {
    const user = userEvent.setup();
    routePost({
      '/recurring/pause': () => {
        currentConfig = { ...BASE_CONFIG, status: 'paused' };
        return Promise.resolve({ config: currentConfig });
      },
    });
    renderSchedule({ role: 'provider' });
    await user.click(await screen.findByRole('button', { name: 'Pause schedule' }));

    expect(await screen.findByRole('button', { name: 'Resume schedule' })).toBeEnabled();
    expect(post).toHaveBeenCalledWith('/api/v1/contracts/contract-1/recurring/pause');
    expect(screen.queryByRole('button', { name: 'Pause schedule' })).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Recurring schedule paused');
  });

  it('resumes a paused schedule', async () => {
    const user = userEvent.setup();
    currentConfig = { ...BASE_CONFIG, status: 'paused' };
    routePost({
      '/recurring/resume': () => {
        currentConfig = BASE_CONFIG;
        return Promise.resolve({ config: currentConfig });
      },
    });
    renderSchedule();
    await user.click(await screen.findByRole('button', { name: 'Resume schedule' }));

    expect(await screen.findByRole('button', { name: 'Pause schedule' })).toBeEnabled();
    expect(post).toHaveBeenCalledWith('/api/v1/contracts/contract-1/recurring/resume');
  });

  it('keeps the schedule active and reports the reason when pausing fails', async () => {
    const user = userEvent.setup();
    routePost({
      '/recurring/pause': () => Promise.reject(new FakeApiError(409, 'visit in progress')),
    });
    renderSchedule();
    await user.click(await screen.findByRole('button', { name: 'Pause schedule' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('visit in progress');
    });
    expect(screen.getByRole('button', { name: 'Pause schedule' })).toBeEnabled();
  });

  it('asks for confirmation before cancelling and can be backed out of', async () => {
    const user = userEvent.setup();
    renderSchedule();
    await user.click(await screen.findByRole('button', { name: 'Cancel schedule' }));

    expect(screen.getByText(/Takes effect after the next scheduled occurrence/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel schedule' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep schedule' }));
    expect(screen.queryByText(/Takes effect after/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel schedule' })).toBeEnabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('cancels on confirm, removes the controls and offers the customer a repost', async () => {
    const user = userEvent.setup();
    routePost({
      '/recurring/cancel': () => {
        currentConfig = { ...BASE_CONFIG, status: 'cancelled' };
        return Promise.resolve({ config: currentConfig });
      },
    });
    renderSchedule();
    await user.click(await screen.findByRole('button', { name: 'Cancel schedule' }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancel' }));

    expect(await screen.findByTestId('recurring-repost-cta')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/contracts/contract-1/recurring/cancel');
    expect(screen.queryByRole('button', { name: 'Pause schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm cancel' })).not.toBeInTheDocument();
    // A cancelled schedule is read-only for the customer too.
    expect(screen.queryByLabelText(/Future rate/)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Auto-approve')).toBeInTheDocument();
  });

  it('keeps the confirmation open when the cancel request fails', async () => {
    const user = userEvent.setup();
    routePost({ '/recurring/cancel': () => Promise.reject(new Error('offline')) });
    renderSchedule();
    await user.click(await screen.findByRole('button', { name: 'Cancel schedule' }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancel' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to cancel recurring schedule');
    });
    expect(screen.getByRole('button', { name: 'Confirm cancel' })).toBeEnabled();
  });

  it('treats the US spelling "canceled" as cancelled', async () => {
    currentConfig = { ...BASE_CONFIG, status: 'canceled', auto_approve: true };
    renderSchedule({ role: 'provider' });
    await screen.findByTestId('recurring-schedule');
    expect(screen.queryByRole('button', { name: 'Cancel schedule' })).not.toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('gives a viewer who is neither party no controls', async () => {
    renderSchedule({ role: 'observer' });
    await findVisit('inst-sched');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('offers only Cancel for a schedule in an unrecognised state', async () => {
    currentConfig = { ...BASE_CONFIG, status: 'pending_setup' };
    currentInstances = [];
    renderSchedule({ role: 'provider' });
    await screen.findByText('Pending Setup');
    expect(screen.getByRole('button', { name: 'Cancel schedule' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Pause schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume schedule' })).not.toBeInTheDocument();
  });
});

describe('RecurringSchedule — future rate', () => {
  it.each(['0', '-5'])('keeps Save disabled for a rate of %s', async (value) => {
    const user = userEvent.setup();
    renderSchedule();
    const input = await screen.findByLabelText(/Future rate/);
    const save = screen.getByRole('button', { name: 'Save future rate' });
    expect(save).toBeDisabled();
    await user.type(input, value);
    expect(save).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('rounds dollars to integer cents and clears the field after saving', async () => {
    const user = userEvent.setup();
    renderSchedule();
    const input = await screen.findByLabelText(/Future rate/);
    await user.type(input, '19.99');
    await user.click(screen.getByRole('button', { name: 'Save future rate' }));

    await waitFor(() => {
      expect(input).toHaveValue(null);
    });
    expect(patch).toHaveBeenCalledWith(
      '/api/v1/contracts/contract-1/recurring',
      { proposed_rate_cents: 1999 },
      { 'Idempotency-Key': 'recurring-config:contract-1::1999' },
    );
    expect(toast.success).toHaveBeenCalledWith('Proposed rate updated for future visits');
  });

  it('keeps the typed rate when the save fails', async () => {
    const user = userEvent.setup();
    patch.mockRejectedValue(new FakeApiError(422, 'rate too low'));
    renderSchedule();
    const input = await screen.findByLabelText(/Future rate/);
    await user.type(input, '5');
    await user.click(screen.getByRole('button', { name: 'Save future rate' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('rate too low');
    });
    expect(input).toHaveValue(5);
  });

  it('turns auto-approve off when it is currently on', async () => {
    const user = userEvent.setup();
    currentConfig = { ...BASE_CONFIG, auto_approve: true };
    renderSchedule();
    const toggle = await screen.findByRole('switch', { name: 'Auto-approve visits' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith(
        '/api/v1/contracts/contract-1/recurring',
        { auto_approve: false },
        expect.any(Object),
      );
    });
  });
});

describe('RecurringSchedule — customer approves a visit', () => {
  beforeEach(() => {
    currentInstances = [COMPLETED];
  });

  async function approve(user: ReturnType<typeof userEvent.setup>) {
    renderSchedule();
    const visit = await findVisit('inst-done');
    await user.click(within(visit).getByRole('button', { name: 'Approve visit' }));
    return visit;
  }

  it('confirms an off-session charge and marks the visit funded with nothing left to pay', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-done/approve': () =>
        Promise.resolve({ instance: COMPLETED, off_session_charged: true, client_secret: REAL_PI }),
    });
    const visit = await approve(user);

    expect(
      await screen.findByText(
        'Visit approved. Saved card charged off-session — $120.00 held in escrow.',
      ),
    ).toHaveAttribute('role', 'status');
    expect(visit).toHaveTextContent('Approved · Escrow funded');
    expect(within(visit).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
  });

  it('opens checkout with the server amount and names the off-session residual', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-done/approve': () =>
        Promise.resolve({
          instance: COMPLETED,
          payment: { id: 'pay-nested', client_secret: REAL_PI },
          off_session_charge_residual: 'card_declined',
        }),
    });
    const visit = await approve(user);

    expect(
      await screen.findByText(
        'Visit approved. Complete payment for $120.00 to hold escrow. (on-session residual: card_declined)',
      ),
    ).toBeInTheDocument();
    const form = within(visit).getByTestId('payment-confirmation');
    expect(form).toHaveTextContent('Pay visit · $120.00');
    expect(form).toHaveAttribute('data-return-path', '/contracts/contract-1');
    expect(within(visit).queryByRole('button', { name: 'Approve visit' })).not.toBeInTheDocument();
  });

  it('prefers the gateway payment_error over the generic residual copy', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-done/approve': () =>
        Promise.resolve({
          instance: COMPLETED,
          payment_residual: 'stripe_unconfigured',
          payment_error: 'Provider has not finished payout setup.',
        }),
    });
    await approve(user);
    expect(await screen.findByText('Provider has not finished payout setup.')).toBeInTheDocument();
  });

  it('explains a missing PaymentIntent and leaves a Pay visit button for later', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-done/approve': () =>
        Promise.resolve({ instance: COMPLETED, payment_residual: 'stripe_unconfigured' }),
    });
    const visit = await approve(user);

    expect(
      await screen.findByText(
        'Visit approved; escrow PaymentIntent was not created (stripe_unconfigured). Use Pay visit when ready.',
      ),
    ).toBeInTheDocument();
    expect(within(visit).getByRole('button', { name: 'Pay visit $120.00' })).toBeEnabled();
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
  });

  it('just confirms approval when the gateway returns no money fields', async () => {
    const user = userEvent.setup();
    routePost({ '/inst-done/approve': () => Promise.resolve({ instance: COMPLETED }) });
    const visit = await approve(user);

    expect(await screen.findByText('Visit approved.')).toBeInTheDocument();
    expect(visit).toHaveTextContent('Completed · Approved');
    expect(within(visit).queryByRole('button', { name: 'Approve visit' })).not.toBeInTheDocument();
  });

  it('raises an alert and keeps Approve available when the request fails', async () => {
    const user = userEvent.setup();
    routePost({ '/inst-done/approve': () => Promise.reject(new FakeApiError(500, '')) });
    const visit = await approve(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to approve visit. Please try again.',
    );
    await waitFor(() => {
      expect(within(visit).getByRole('button', { name: 'Approve visit' })).toBeEnabled();
    });
    expect(visit).not.toHaveTextContent('Approved');
  });

  it('captures a dev-stack secret with one tap and clears the sticky create key', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-done/approve': () =>
        Promise.resolve({ instance: COMPLETED, payment_id: 'pay-dev', client_secret: DEV_SECRET }),
      '/payments/pay-dev/process': () => Promise.resolve({ id: 'pay-dev', status: 'escrow' }),
    });
    const visit = await approve(user);

    const pay = await within(visit).findByRole('button', { name: 'Pay visit · $120.00' });
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
    await user.click(pay);

    expect(
      await screen.findByText('Visit paid — $120.00 held in escrow. Release after work is done.'),
    ).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      '/api/v1/payments/pay-dev/process',
      { payment_method_id: '' },
      { 'Idempotency-Key': 'process-payment:pay-dev' },
    );
    expect(clearIdempotencyKey).toHaveBeenCalledWith('create-payment:contract-1:12000:inst-done');
    expect(visit).toHaveTextContent('Escrow funded');
    expect(within(visit).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the dev Pay button for a retry when capture fails', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-done/approve': () =>
        Promise.resolve({ instance: COMPLETED, payment_id: 'pay-dev', client_secret: DEV_SECRET }),
      '/payments/pay-dev/process': () => Promise.reject(new FakeApiError(402, 'card declined')),
    });
    const visit = await approve(user);
    await user.click(await within(visit).findByRole('button', { name: 'Pay visit · $120.00' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not capture visit payment. Tap Pay visit to retry.',
    );
    expect(toast.error).toHaveBeenCalledWith('card declined');
    await waitFor(() => {
      expect(within(visit).getByRole('button', { name: 'Pay visit · $120.00' })).toBeEnabled();
    });
    expect(visit).not.toHaveTextContent('Escrow funded');
    expect(clearIdempotencyKey).not.toHaveBeenCalledWith(
      'create-payment:contract-1:12000:inst-done',
    );
  });

  describe('with the PaymentElement open', () => {
    async function openForm(user: ReturnType<typeof userEvent.setup>, processOk: boolean) {
      routePost({
        '/inst-done/approve': () =>
          Promise.resolve({ instance: COMPLETED, payment_id: 'pay-99', client_secret: REAL_PI }),
        '/payments/pay-99/process': () =>
          processOk
            ? Promise.resolve({ id: 'pay-99', status: 'escrow' })
            : Promise.reject(new Error('capture failed')),
      });
      const visit = await approve(user);
      await within(visit).findByTestId('payment-confirmation');
      return visit;
    }

    it('captures after a settled confirmation and closes the form', async () => {
      const user = userEvent.setup();
      const visit = await openForm(user, true);
      capturedOnOutcome?.(outcome({ kind: 'succeeded', settled: true }));

      expect(
        await screen.findByText('Visit paid — $120.00 held in escrow. Release after work is done.'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
      expect(visit).toHaveTextContent('Escrow funded');
    });

    it.each(['requires_payment_method', 'requires_action', 'canceled', 'error'] as const)(
      'does not capture a %s outcome and keeps the form for a retry',
      async (kind) => {
        const user = userEvent.setup();
        const visit = await openForm(user, true);
        capturedOnOutcome?.(outcome({ kind, settled: false, retryable: true }));

        expect(await screen.findByText(/^Payment not completed\. Tap Pay visit to retry/)).toBeInTheDocument();
        expect(post).not.toHaveBeenCalledWith(
          expect.stringContaining('/process'),
          expect.anything(),
          expect.anything(),
        );
        expect(within(visit).getByTestId('payment-confirmation')).toBeInTheDocument();
        expect(visit).not.toHaveTextContent('Escrow funded');
      },
    );

    it('raises an alert and keeps the form when capture fails after confirmation', async () => {
      const user = userEvent.setup();
      const visit = await openForm(user, false);
      capturedOnOutcome?.(outcome({ kind: 'processing', settled: false }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not capture visit payment. Tap Pay visit to retry.',
      );
      expect(within(visit).getByTestId('payment-confirmation')).toBeInTheDocument();
      expect(visit).not.toHaveTextContent('Escrow funded');
    });

    it('tells the customer how to retry when they cancel the form', async () => {
      const user = userEvent.setup();
      await openForm(user, true);
      await user.click(screen.getByRole('button', { name: 'Cancel payment' }));
      expect(toast.message).toHaveBeenCalledWith(
        'Payment canceled. Tap Pay visit to retry; create uses a sticky Idempotency-Key.',
      );
    });
  });
});

describe('RecurringSchedule — customer pays an auto-approved visit', () => {
  beforeEach(() => {
    currentInstances = [AUTO];
  });

  async function pay(user: ReturnType<typeof userEvent.setup>) {
    renderSchedule();
    const visit = await findVisit('inst-auto');
    await user.click(within(visit).getByRole('button', { name: 'Pay visit $95.00' }));
    return visit;
  }

  it('prompts to complete payment for the server amount when a real secret comes back', async () => {
    const user = userEvent.setup();
    routePost({
      '/api/v1/payments': () => Promise.resolve({ id: 'pay-new', client_secret: REAL_PI }),
    });
    const visit = await pay(user);

    expect(
      await screen.findByText('Complete payment for $95.00 to hold escrow.'),
    ).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      '/api/v1/payments',
      {
        contract_id: 'contract-1',
        amount_cents: 9500,
        recurring_instance_id: 'inst-auto',
        provider_id: 'prov-1',
      },
      { 'Idempotency-Key': 'create-payment:contract-1:9500:inst-auto' },
    );
    expect(within(visit).getByTestId('payment-confirmation')).toHaveTextContent(
      'Pay visit · $95.00',
    );
    expect(within(visit).queryByRole('button', { name: 'Pay visit $95.00' })).not.toBeInTheDocument();
  });

  it('creates and captures in one go on the dev stack', async () => {
    const user = userEvent.setup();
    routePost({
      '/api/v1/payments': () => Promise.resolve({ id: 'pay-dev', client_secret: DEV_SECRET }),
      '/payments/pay-dev/process': () => Promise.resolve({ id: 'pay-dev', status: 'escrow' }),
    });
    const visit = await pay(user);

    expect(
      await screen.findByText('Visit paid — $95.00 held in escrow. Release after work is done.'),
    ).toBeInTheDocument();
    expect(clearIdempotencyKey).toHaveBeenCalledWith('create-payment:contract-1:9500:inst-auto');
    expect(visit).toHaveTextContent('Auto-approved · Escrow funded');
    expect(within(visit).queryByRole('button')).not.toBeInTheDocument();
  });

  it('raises an alert and keeps Pay visit when no confirmable secret is returned', async () => {
    const user = userEvent.setup();
    routePost({ '/api/v1/payments': () => Promise.resolve({ id: 'pay-new' }) });
    const visit = await pay(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no confirmable client_secret was returned/,
    );
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(visit).getByRole('button', { name: 'Pay visit $95.00' })).toBeEnabled();
    });
  });

  it('raises an alert when the payment cannot be created', async () => {
    const user = userEvent.setup();
    routePost({
      '/api/v1/payments': () => Promise.reject(new FakeApiError(503, 'payments are paused')),
    });
    const visit = await pay(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not start visit payment. Please try again.',
    );
    expect(toast.error).toHaveBeenCalledWith('payments are paused');
    await waitFor(() => {
      expect(within(visit).getByRole('button', { name: 'Pay visit $95.00' })).toBeEnabled();
    });
  });
});

describe('RecurringSchedule — provider completes a visit', () => {
  beforeEach(() => {
    currentInstances = [SCHEDULED];
  });

  async function complete(
    user: ReturnType<typeof userEvent.setup>,
    role: 'provider' | 'both' = 'provider',
  ) {
    renderSchedule({ role });
    const visit = await findVisit('inst-sched');
    await user.click(within(visit).getByRole('button', { name: 'Mark visit complete' }));
    return visit;
  }

  const DONE: ContractRecurringInstance = { ...SCHEDULED, status: 'completed' };
  const DONE_AUTO: ContractRecurringInstance = { ...DONE, auto_approved: true };

  it('confirms completion and posts to the complete endpoint', async () => {
    const user = userEvent.setup();
    routePost({ '/inst-sched/complete': () => Promise.resolve({ instance: DONE }) });
    await complete(user);

    expect(await screen.findByText('Visit marked complete.')).toHaveAttribute('role', 'status');
    expect(post).toHaveBeenCalledWith(
      '/api/v1/contracts/contract-1/recurring/instances/inst-sched/complete',
    );
  });

  it('tells the provider the customer can pay when an auto-approved visit has an open intent', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-sched/complete': () =>
        Promise.resolve({ instance: DONE_AUTO, payment_id: 'pay-1', client_secret: REAL_PI }),
    });
    await complete(user);

    expect(
      await screen.findByText(
        'Visit complete and auto-approved. Customer can pay $120.00 to hold escrow.',
      ),
    ).toBeInTheDocument();
    // The provider never sees a payment form or Pay button.
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay visit/ })).not.toBeInTheDocument();
  });

  it('says only that the visit is complete when it still needs customer approval', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-sched/complete': () =>
        Promise.resolve({ instance: DONE, payment_id: 'pay-1', client_secret: REAL_PI }),
    });
    await complete(user);
    expect(await screen.findByText('Visit marked complete.')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
  });

  it('reports an off-session charge on auto-approved completion', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-sched/complete': () =>
        Promise.resolve({ instance: DONE_AUTO, off_session_charged: true }),
    });
    await complete(user);
    expect(
      await screen.findByText(
        'Visit complete and auto-approved. Saved card charged off-session — $120.00 held in escrow.',
      ),
    ).toBeInTheDocument();
  });

  it('explains when no escrow intent could be created', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-sched/complete': () =>
        Promise.resolve({ instance: DONE_AUTO, payment_residual: 'no_default_payment_method' }),
    });
    await complete(user);
    expect(
      await screen.findByText(
        'Visit complete; escrow PaymentIntent was not created (no_default_payment_method). Customer can use Pay visit.',
      ),
    ).toBeInTheDocument();
  });

  it('raises an alert and keeps the button when completion fails', async () => {
    const user = userEvent.setup();
    routePost({ '/inst-sched/complete': () => Promise.reject(new Error('offline')) });
    const visit = await complete(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to complete visit. Please try again.',
    );
    expect(toast.error).toHaveBeenCalledWith('Failed to complete visit');
    await waitFor(() => {
      expect(within(visit).getByRole('button', { name: 'Mark visit complete' })).toBeEnabled();
    });
  });

  it('opens checkout straight away when the completing user is also the customer', async () => {
    const user = userEvent.setup();
    routePost({
      '/inst-sched/complete': () =>
        Promise.resolve({ instance: DONE_AUTO, payment_id: 'pay-1', client_secret: REAL_PI }),
    });
    const visit = await complete(user, 'both');

    expect(
      await screen.findByText(
        'Visit complete and auto-approved. Pay visit when ready to hold escrow ($120.00).',
      ),
    ).toBeInTheDocument();
    expect(within(visit).getByTestId('payment-confirmation')).toHaveTextContent(
      'Pay visit · $120.00',
    );
  });
});

describe('RecurringSchedule — repost after cancellation', () => {
  function repostParams(): URLSearchParams {
    const link = screen.getByRole('link', { name: /Post a new job for remaining visits/ });
    const href = link.getAttribute('href') ?? '';
    return new URLSearchParams(href.split('?')[1]);
  }

  beforeEach(() => {
    currentConfig = { ...BASE_CONFIG, status: 'cancelled', frequency: 'monthly' };
    currentInstances = [];
  });

  it('prefills property, category and starting bid from the linked job', async () => {
    jobState.job = { property_id: 'prop-9', category_id: 'cat-3', starting_bid_cents: 45000 };
    renderSchedule({ jobId: 'job-7', jobTitle: 'Monthly pool cleaning', amountCents: 99900 });
    await screen.findByTestId('recurring-repost-cta');

    expect(jobState.requestedIds).toContain('job-7');
    const q = repostParams();
    expect(q.get('recurrence_frequency')).toBe('monthly');
    expect(q.get('title')).toBe('Monthly pool cleaning');
    expect(q.get('property_id')).toBe('prop-9');
    expect(q.get('category_id')).toBe('cat-3');
    expect(q.get('starting_bid_cents')).toBe('45000');
  });

  it('falls back to the contract amount when the job has no starting bid', async () => {
    jobState.job = { property_id: 'prop-9', starting_bid_cents: 0 };
    renderSchedule({ jobId: 'job-7', amountCents: 99900 });
    await screen.findByTestId('recurring-repost-cta');
    expect(repostParams().get('starting_bid_cents')).toBe('99900');
  });

  it('omits the starting bid when neither the job nor the contract has an amount', async () => {
    renderSchedule({ jobId: 'job-7', amountCents: 0 });
    await screen.findByTestId('recurring-repost-cta');
    const q = repostParams();
    expect(q.has('starting_bid_cents')).toBe(false);
    expect(q.has('property_id')).toBe(false);
  });

  it('does not fetch the linked job for a provider or for a live schedule', async () => {
    renderSchedule({ role: 'provider', jobId: 'job-7' });
    await screen.findByTestId('recurring-schedule');
    expect(jobState.requestedIds.every((id) => id === '')).toBe(true);
    expect(screen.queryByTestId('recurring-repost-cta')).not.toBeInTheDocument();
  });

  it('does not fetch the linked job while the customer schedule is still active', async () => {
    currentConfig = BASE_CONFIG;
    renderSchedule({ jobId: 'job-7' });
    await screen.findByTestId('recurring-schedule');
    expect(jobState.requestedIds.every((id) => id === '')).toBe(true);
  });
});
