// Admin moderation pages — a rejected mutation. The confirm handlers awaited
// mutateAsync with no catch and were called as `void handleConfirm()`, so a
// failed suspend / resolve became an unhandled rejection: no message, and the
// hooks behind these pages have no error toast of their own.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackUnhandledRejections, unhandledRejections } from './_rejection-probe';

const h = vi.hoisted(() => ({
  toastError: vi.fn<(message: string) => void>(),
  listings: vi.fn(),
  reports: vi.fn(),
  suspend: vi.fn<(vars: unknown) => Promise<unknown>>(),
  reactivate: vi.fn<(vars: unknown) => Promise<unknown>>(),
  cancel: vi.fn<(vars: unknown) => Promise<unknown>>(),
  resolveJob: vi.fn<(vars: unknown) => Promise<unknown>>(),
  resolveUser: vi.fn<(vars: unknown) => Promise<unknown>>(),
  resolveGoods: vi.fn<(vars: unknown) => Promise<unknown>>(),
}));

vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }));

vi.mock('@/hooks/useAdmin', () => ({
  useAdminListings: () => h.listings() as unknown,
  useSuspendListing: () => ({ mutateAsync: h.suspend, isPending: false }),
  useReactivateListing: () => ({ mutateAsync: h.reactivate, isPending: false }),
  useCancelListing: () => ({ mutateAsync: h.cancel, isPending: false }),
  useAdminJobReports: () => h.reports() as unknown,
  useResolveJobReport: () => ({ mutateAsync: h.resolveJob, isPending: false }),
  useAdminUserReports: () => h.reports() as unknown,
  useResolveUserReport: () => ({ mutateAsync: h.resolveUser, isPending: false }),
  useAdminReports: () => h.reports() as unknown,
  useResolveReport: () => ({ mutateAsync: h.resolveGoods, isPending: false }),
}));

// The status filter is not under test; Radix Select needs APIs jsdom lacks.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

import AdminGoodsReportsPage from '@/app/(dashboard)/admin/goods-reports/page';
import AdminJobReportsPage from '@/app/(dashboard)/admin/job-reports/page';
import AdminListingsPage from '@/app/(dashboard)/admin/listings/page';
import AdminUserReportsPage from '@/app/(dashboard)/admin/user-reports/page';

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

const PAGINATION = { page: 1, page_size: 20, total: 1 };

const LISTING = {
  id: 'l-1',
  title: 'Vintage Drill Press',
  seller_id: 'seller-1',
  seller_email: 'seller@example.com',
  status: 'active',
  is_hidden: false,
  starting_price_cents: 5000,
  current_bid_cents: 7500,
  bid_count: 3,
  open_report_count: 0,
  auction_ends_at: '2026-07-04T12:00:00Z',
  created_at: '2026-06-01T12:00:00Z',
};

const REPORT = {
  id: 'r-1',
  job_id: 'j-1',
  job_title: 'Fix sink',
  listing_id: 'l-1',
  listing_title: 'Vintage Drill Press',
  reporter_id: 'u-1',
  reporter_email: 'reporter@example.com',
  reported_user_id: 'u-2',
  reported_user_email: 'reported@example.com',
  reason: 'spam',
  description: 'Looks like spam',
  status: 'open',
  created_at: '2026-06-01T12:00:00Z',
};

function dialog(): HTMLDialogElement {
  const el = document.querySelector('dialog');
  if (!el) throw new Error('expected a confirm dialog');
  return el;
}

/** The dialog's confirm button (the row button of the same name is outside it). */
function confirmButton(label: string): HTMLButtonElement {
  const button = dialog().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`expected a "${label}" confirm button`);
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.listings.mockReturnValue({
    data: { listings: [LISTING], pagination: PAGINATION },
    isLoading: false,
    isError: false,
  });
  h.reports.mockReturnValue({
    data: { reports: [REPORT], pagination: PAGINATION },
    isLoading: false,
    isError: false,
  });
});

describe('admin listings — a failed action', () => {
  it('says why the suspend failed, keeps the dialog and the reason, and rejects nothing', async () => {
    h.suspend.mockRejectedValue(new Error('listing is locked by an open dispute'));
    render(createElement(AdminListingsPage));

    fireEvent.click(screen.getByRole('button', { name: 'Suspend listing: Vintage Drill Press' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'counterfeit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Listing', hidden: true }));

    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith('listing is locked by an open dispute');
    });
    expect(h.suspend).toHaveBeenCalledWith({ listingId: 'l-1', reason: 'counterfeit' });
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(screen.getByLabelText('Reason')).toHaveProperty('value', 'counterfeit');
    expect(await unhandledRejections()).toEqual([]);
  });

  it('falls back to a plain message when the error carries none', async () => {
    h.cancel.mockRejectedValue('boom');
    render(createElement(AdminListingsPage));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel listing: Vintage Drill Press' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'fraud' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Listing', hidden: true }));

    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith('Failed to cancel listing');
    });
    expect(await unhandledRejections()).toEqual([]);
  });

  it('still closes the dialog and clears the reason when the action succeeds', async () => {
    h.suspend.mockResolvedValue(undefined);
    render(createElement(AdminListingsPage));

    fireEvent.click(screen.getByRole('button', { name: 'Suspend listing: Vintage Drill Press' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'counterfeit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Listing', hidden: true }));

    await waitFor(() => {
      expect(dialog().hasAttribute('open')).toBe(false);
    });
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe.each([
  ['job reports', AdminJobReportsPage, h.resolveJob],
  ['user reports', AdminUserReportsPage, h.resolveUser],
  ['goods reports', AdminGoodsReportsPage, h.resolveGoods],
] as const)('admin %s — a failed resolve', (_name, Page, resolve) => {
  it('says why it failed, keeps the dialog and the notes, and rejects nothing', async () => {
    resolve.mockRejectedValue(new Error('report was already resolved'));
    render(createElement(Page));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'duplicate' } });
    confirmButton('Dismiss').click();

    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith('report was already resolved');
    });
    expect(resolve).toHaveBeenCalledWith({ reportId: 'r-1', action: 'dismiss', notes: 'duplicate' });
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(screen.getByLabelText('Notes (optional)')).toHaveProperty('value', 'duplicate');
    expect(await unhandledRejections()).toEqual([]);
  });

  it('still closes the dialog when the resolve succeeds', async () => {
    resolve.mockResolvedValue(undefined);
    render(createElement(Page));

    fireEvent.click(screen.getByRole('button', { name: 'Take Action' }));
    confirmButton('Take Action').click();

    await waitFor(() => {
      expect(dialog().hasAttribute('open')).toBe(false);
    });
    expect(h.toastError).not.toHaveBeenCalled();
  });
});
