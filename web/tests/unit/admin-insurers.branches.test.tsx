// Branch coverage for the admin insurers page, complementing
// admin-insurers.test.tsx: status-dependent actions and their toasts, the
// rate-card table fallbacks, onboarding validation, rate-card row editing, and
// the onboard success / failure callbacks.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { closest, nth } from './app/dashboard/_admin-branch-helpers';
import { withQueryClient } from './app/dashboard/_helpers';

vi.mock('@/components/ui/select', () => import('./app/dashboard/_native-select-mock'));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => {
      toastSuccess(...args);
    },
    error: (...args: unknown[]) => {
      toastError(...args);
    },
  },
}));

const useAdminInsurersMock = vi.fn();
const onboardMutate = vi.fn();
const updateMutate = vi.fn();
const pending = { onboard: false, update: false };

vi.mock('@/hooks/useAdmin', async () => {
  // Keep the real const-object enums so labels and values are real.
  const actual = await vi.importActual<typeof import('@/hooks/useAdmin')>('@/hooks/useAdmin');
  return {
    ...actual,
    useAdminInsurers: () => useAdminInsurersMock() as unknown,
    useOnboardInsurer: () => ({ mutate: onboardMutate, isPending: pending.onboard }),
    useUpdateInsurer: () => ({ mutate: updateMutate, isPending: pending.update }),
  };
});

import AdminInsurersPage from '@/app/(dashboard)/admin/insurers/page';
import type { Insurer } from '@/hooks/useAdmin';

interface MutateOptions {
  onSuccess: () => void;
  onError: (err: unknown) => void;
}

function makeInsurer(overrides: Partial<Insurer> = {}): Insurer {
  return {
    id: 'ins-1',
    name: 'Acme Mutual',
    slug: 'acme-mutual',
    status: 'pending',
    created_at: '2026-06-01T12:00:00Z',
    products: [
      {
        id: 'p-1',
        product_type: 'workmanship_warranty',
        base_rate_bps: 250,
        min_premium_cents: 5000,
        active: true,
      },
    ],
    ...overrides,
  };
}

function loaded(insurers: Insurer[]) {
  useAdminInsurersMock.mockReturnValue({ data: { insurers }, isLoading: false, isError: false });
}

function renderPage() {
  return render(withQueryClient(createElement(AdminInsurersPage)));
}

function card(name: string): HTMLElement {
  return closest(screen.getByText(name), 'div.glass');
}

function lastCall(mock: typeof onboardMutate): [unknown, MutateOptions] {
  return nth(mock.mock.calls, mock.mock.calls.length - 1) as [unknown, MutateOptions];
}

async function fillIdentity(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Beta Insurance');
  await user.type(screen.getByLabelText('Slug'), 'beta-insurance');
}

beforeEach(() => {
  vi.clearAllMocks();
  useAdminInsurersMock.mockReset();
  pending.onboard = false;
  pending.update = false;
});

describe('AdminInsurersPage — insurer card actions', () => {
  it('treats a response with no insurers array as an empty marketplace', () => {
    useAdminInsurersMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderPage();

    expect(screen.getByText('No insurers yet')).toBeInTheDocument();
  });

  it('offers only Suspend for an approved insurer and only Approve for a suspended one', () => {
    loaded([
      makeInsurer({ id: 'a', name: 'Approved Co', slug: 'approved-co', status: 'approved' }),
      makeInsurer({ id: 's', name: 'Suspended Co', slug: 'suspended-co', status: 'suspended' }),
    ]);
    renderPage();

    const approved = card('Approved Co');
    expect(within(approved).getByText('Approved')).toBeInTheDocument();
    expect(within(approved).getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(within(approved).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    const suspended = card('Suspended Co');
    expect(within(suspended).getByText('Suspended')).toBeInTheDocument();
    expect(within(suspended).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(suspended).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
  });

  it('suspends an insurer and toasts on success', async () => {
    const user = userEvent.setup();
    loaded([makeInsurer({ id: 'ins-4', status: 'approved' })]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Suspend' }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [payload, options] = lastCall(updateMutate);
    expect(payload).toEqual({ id: 'ins-4', status: 'suspended' });

    options.onSuccess();
    expect(toastSuccess).toHaveBeenCalledWith('Acme Mutual suspended');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('toasts the approval, and the server reason when an update fails', async () => {
    const user = userEvent.setup();
    loaded([makeInsurer()]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const [, options] = lastCall(updateMutate);

    options.onSuccess();
    expect(toastSuccess).toHaveBeenCalledWith('Acme Mutual approved');

    options.onError(new Error('Insurer has open claims'));
    expect(toastError).toHaveBeenCalledWith('Insurer has open claims');

    options.onError(undefined);
    expect(toastError).toHaveBeenLastCalledWith('Failed to update insurer');
  });

  it('disables status actions while an update is in flight', () => {
    pending.update = true;
    loaded([makeInsurer()]);
    renderPage();

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeDisabled();
  });

  it('says so when an insurer has no products, and flags inactive products', () => {
    loaded([
      makeInsurer({ id: 'e', name: 'Empty Co', slug: 'empty-co', products: [] }),
      makeInsurer({
        id: 'f',
        name: 'Full Co',
        slug: 'full-co',
        products: [
          {
            id: 'p-1',
            product_type: 'liability',
            base_rate_bps: 125,
            min_premium_cents: 2550,
            active: false,
          },
        ],
      }),
    ]);
    renderPage();

    const empty = card('Empty Co');
    expect(within(empty).getByText('No products configured.')).toBeInTheDocument();
    expect(within(empty).queryByRole('table')).not.toBeInTheDocument();

    const full = card('Full Co');
    expect(within(full).getByText('Liability')).toBeInTheDocument();
    expect(within(full).getByText('1.25%')).toBeInTheDocument();
    expect(within(full).getByText('$25.50')).toBeInTheDocument();
    expect(within(full).getByText('Inactive')).toBeInTheDocument();
  });
});

describe('AdminInsurersPage — onboarding validation', () => {
  it('requires a name before anything else', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();

    await user.type(screen.getByLabelText('Name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Onboard insurer' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Insurer name is required.');
    expect(onboardMutate).not.toHaveBeenCalled();
  });

  it('rejects a negative base rate', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();

    await fillIdentity(user);
    fireEvent.change(screen.getByLabelText('Base rate (%)'), { target: { value: '-1' } });
    fireEvent.change(screen.getByLabelText('Min premium ($)'), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: 'Onboard insurer' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Every rate-card row needs a valid base rate.',
    );
    expect(onboardMutate).not.toHaveBeenCalled();
  });

  it('rejects a negative minimum premium, then clears the error on a valid resubmit', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();

    await fillIdentity(user);
    fireEvent.change(screen.getByLabelText('Base rate (%)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Min premium ($)'), { target: { value: '-10' } });
    await user.click(screen.getByRole('button', { name: 'Onboard insurer' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Every rate-card row needs a valid minimum premium.',
    );
    expect(onboardMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Min premium ($)'), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: 'Onboard insurer' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onboardMutate).toHaveBeenCalledTimes(1);
  });
});

describe('AdminInsurersPage — rate-card rows', () => {
  it('cannot remove the only row, and can once a second is added', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();

    expect(screen.getByRole('button', { name: 'Remove rate-card row 1' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add row' }));

    expect(screen.getByRole('button', { name: 'Remove rate-card row 1' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove rate-card row 2' })).toBeEnabled();
    expect(screen.getAllByLabelText('Base rate (%)')).toHaveLength(2);
  });

  it('submits each row with its own product type, rate and premium', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();

    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Add row' }));

    const types = screen.getAllByRole('combobox');
    const rates = screen.getAllByLabelText('Base rate (%)');
    const premiums = screen.getAllByLabelText('Min premium ($)');
    await user.type(nth(rates, 0), '2.5');
    await user.type(nth(premiums, 0), '50');
    fireEvent.change(nth(types, 1), { target: { value: 'completion_guarantee' } });
    await user.type(nth(rates, 1), '1.75');
    await user.type(nth(premiums, 1), '19.99');

    await user.click(screen.getByRole('button', { name: 'Onboard insurer' }));

    expect(lastCall(onboardMutate)[0]).toEqual({
      name: 'Beta Insurance',
      slug: 'beta-insurance',
      products: [
        { product_type: 'property_damage', base_rate_bps: 250, min_premium_cents: 5000 },
        { product_type: 'completion_guarantee', base_rate_bps: 175, min_premium_cents: 1999 },
      ],
    });
  });

  it('removes the chosen row and keeps the other', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();

    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    await user.type(nth(screen.getAllByLabelText('Base rate (%)'), 0), '9');
    await user.type(nth(screen.getAllByLabelText('Min premium ($)'), 0), '9');
    fireEvent.change(nth(screen.getAllByRole('combobox'), 1), { target: { value: 'liability' } });
    await user.type(nth(screen.getAllByLabelText('Base rate (%)'), 1), '3');
    await user.type(nth(screen.getAllByLabelText('Min premium ($)'), 1), '30');

    await user.click(screen.getByRole('button', { name: 'Remove rate-card row 1' }));

    expect(screen.getAllByLabelText('Base rate (%)')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove rate-card row 1' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Onboard insurer' }));

    expect(lastCall(onboardMutate)[0]).toEqual(
      expect.objectContaining({
        products: [{ product_type: 'liability', base_rate_bps: 300, min_premium_cents: 3000 }],
      }),
    );
  });
});

describe('AdminInsurersPage — onboarding result', () => {
  async function submitValid(user: ReturnType<typeof userEvent.setup>) {
    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    for (const input of screen.getAllByLabelText('Base rate (%)')) await user.type(input, '2');
    for (const input of screen.getAllByLabelText('Min premium ($)')) await user.type(input, '20');
    await user.click(screen.getByRole('button', { name: 'Onboard insurer' }));
    return lastCall(onboardMutate)[1];
  }

  it('on success: toasts with the trimmed name and resets the form to one blank row', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();
    const options = await submitValid(user);

    act(() => {
      options.onSuccess();
    });

    expect(toastSuccess).toHaveBeenCalledWith('Beta Insurance onboarded');
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Slug')).toHaveValue('');
    expect(screen.getByLabelText('Base rate (%)')).toHaveValue(null);
    expect(screen.getByLabelText('Min premium ($)')).toHaveValue(null);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('on failure: shows the server reason inline and as a toast, keeping the entries', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();
    const options = await submitValid(user);

    act(() => {
      options.onError(new Error('Slug already taken'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Slug already taken');
    expect(toastError).toHaveBeenCalledWith('Slug already taken');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('Beta Insurance');
    expect(screen.getAllByLabelText('Base rate (%)')).toHaveLength(2);
  });

  it('on a reasonless failure: falls back to a generic message', async () => {
    const user = userEvent.setup();
    loaded([]);
    renderPage();
    const options = await submitValid(user);

    act(() => {
      options.onError(null);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to onboard insurer');
    expect(toastError).toHaveBeenCalledWith('Failed to onboard insurer');
  });

  it('shows "Onboarding..." and blocks resubmission while the request is in flight', () => {
    pending.onboard = true;
    loaded([]);
    renderPage();

    expect(screen.getByRole('button', { name: 'Onboarding...' })).toBeDisabled();
  });
});
