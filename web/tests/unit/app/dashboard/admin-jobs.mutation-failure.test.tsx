// Admin jobs page — a rejected suspend / remove. The confirm handler awaited
// mutateAsync with no catch and was called as `void handleConfirmAction()`, so
// a failed action became an unhandled rejection: no message (the hooks have no
// error toast of their own) and nothing to tell the admin the job is still live.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackUnhandledRejections, unhandledRejections } from './_rejection-probe';

const h = vi.hoisted(() => ({
  toastError: vi.fn<(message: string) => void>(),
  jobs: vi.fn(),
  suspend: vi.fn<(vars: unknown) => Promise<unknown>>(),
  remove: vi.fn<(vars: unknown) => Promise<unknown>>(),
}));

vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }));

vi.mock('@/hooks/useAdmin', () => ({
  useAdminJobs: () => h.jobs() as unknown,
  useSuspendJob: () => ({ mutateAsync: h.suspend, isPending: false }),
  useRemoveJob: () => ({ mutateAsync: h.remove, isPending: false }),
}));

// The status filter is not under test; Radix Select needs APIs jsdom lacks.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import AdminJobsPage from '@/app/(dashboard)/admin/jobs/page';

trackUnhandledRejections();

beforeAll(() => {
  // jsdom has no showModal/close; track `open` so the test can see the dialog.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const JOB = {
  id: 'j-1',
  customer_id: 'cust-1',
  category_id: 'cat-1',
  category_name: 'Plumbing',
  category_slug: 'plumbing',
  title: 'Fix leaky faucet',
  description: 'Kitchen sink',
  status: 'active',
  bid_count: 3,
  lowest_bid_cents: 5000,
  created_at: '2026-06-01T12:00:00Z',
  updated_at: '2026-06-01T12:00:00Z',
};

function dialog(): HTMLDialogElement {
  const el = document.querySelector('dialog');
  if (!el) throw new Error('expected a confirm dialog');
  return el;
}

/** The dialog's confirm button (the row button of a similar name is outside it). */
function confirmButton(label: string): HTMLButtonElement {
  const button = dialog().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`expected a "${label}" confirm button`);
  return button;
}

function openAction(action: 'Suspend' | 'Remove', reason: string) {
  render(createElement(AdminJobsPage));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${action} job:`, 'i') }));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: reason } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.jobs.mockReturnValue({
    data: {
      jobs: [JOB],
      pagination: { totalCount: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
    },
    isLoading: false,
    isError: false,
  });
});

describe('admin jobs — a failed action', () => {
  it('says why the suspend failed, keeps the dialog and the reason, and rejects nothing', async () => {
    h.suspend.mockRejectedValue(new Error('job already has an awarded bid'));
    openAction('Suspend', 'policy violation');
    confirmButton('Suspend Job').click();

    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith('job already has an awarded bid');
    });
    expect(h.suspend).toHaveBeenCalledWith({ jobId: 'j-1', reason: 'policy violation' });
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(screen.getByLabelText('Reason')).toHaveProperty('value', 'policy violation');
    expect(await unhandledRejections()).toEqual([]);
  });

  it('falls back to a plain message naming the action when the error carries none', async () => {
    h.remove.mockRejectedValue('boom');
    openAction('Remove', 'spam');
    confirmButton('Remove Job').click();

    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith('Failed to remove job');
    });
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(await unhandledRejections()).toEqual([]);
  });

  it('still closes the dialog and clears the reason when the action succeeds', async () => {
    h.suspend.mockResolvedValue(undefined);
    openAction('Suspend', 'policy violation');
    confirmButton('Suspend Job').click();

    await waitFor(() => {
      expect(dialog().hasAttribute('open')).toBe(false);
    });
    expect(screen.getByLabelText('Reason')).toHaveProperty('value', '');
    expect(h.toastError).not.toHaveBeenCalled();
  });
});
