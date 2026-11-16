// Branch tests for the account settings page beyond settings-account.test.tsx:
// the data export (GDPR Art. 15), the delete-account friction gate and the
// request it sends, the grace-period screen (restore / sign out), and the
// error copy for API vs unexpected failures.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  apiDelete: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  apiPost: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  download: vi.fn<(path: string, filename: string) => Promise<void>>(),
  logout: vi.fn<() => Promise<void>>(),
  replace: vi.fn<(href: string) => void>(),
  profile: undefined as { phone?: string; phoneVerified?: boolean } | undefined,
  otpProps: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      delete: (path: string, body?: unknown) => h.apiDelete(path, body),
      post: (path: string, body?: unknown) => h.apiPost(path, body),
    },
    downloadAuthenticated: (path: string, filename: string) => h.download(path, filename),
  };
});

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ data: h.profile }),
}));

vi.mock('@/components/forms/PhoneOtpForm', () => ({
  PhoneOtpForm: (props: unknown) => {
    h.otpProps.push(props);
    return createElement('div', { 'data-testid': 'phone-otp-form' });
  },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { logout: () => Promise<void> }) => unknown) =>
    selector({ logout: h.logout }),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (val: string) => void;
    children: React.ReactNode;
  }) =>
    createElement(
      'select',
      {
        value,
        'aria-label': 'Why are you leaving?',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          onValueChange(e.target.value);
        },
      },
      createElement('option', { value: '' }, ''),
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) =>
    createElement('option', { value }, children),
}));

const { ApiError } = await import('@/lib/api');
const { default: AccountSettingsPage } = await import('@/app/(dashboard)/settings/account/page');

const GRACE_DEADLINE = '2026-07-15T18:30:00Z';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  return render(createElement(AccountSettingsPage));
}

function deleteButton(): HTMLElement {
  return screen.getByRole('button', { name: /Request account deletion|Submitting/ });
}

function fillDeletionForm(reason = 'privacy_concerns', confirmation = 'DELETE') {
  fireEvent.change(screen.getByLabelText('Why are you leaving?'), { target: { value: reason } });
  fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: confirmation } });
}

/** Drive the page into the grace-period screen. */
async function scheduleDeletion() {
  h.apiDelete.mockResolvedValue({ created: true, grace_deadline: GRACE_DEADLINE, message: 'ok' });
  renderPage();
  fillDeletionForm();
  fireEvent.click(deleteButton());
  await screen.findByText('Account deletion scheduled');
}

beforeEach(() => {
  h.apiDelete.mockReset();
  h.apiPost.mockReset();
  h.download.mockReset();
  h.logout.mockReset();
  h.logout.mockResolvedValue(undefined);
  h.replace.mockReset();
  h.profile = { phone: '+15551234567', phoneVerified: true };
  h.otpProps.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AccountSettingsPage — phone verification seed', () => {
  it('passes the profile phone and verified flag to the OTP form', () => {
    renderPage();
    expect(h.otpProps.at(-1)).toEqual({ initialPhone: '+15551234567', phoneVerified: true });
  });

  it('treats a profile that has not loaded as unverified with no phone', () => {
    h.profile = undefined;
    renderPage();
    expect(h.otpProps.at(-1)).toEqual({ initialPhone: undefined, phoneVerified: false });
  });

  it('links to the public policy pages', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
  });
});

describe('AccountSettingsPage — data export', () => {
  it('downloads the export to a dated filename and confirms it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-09T23:15:00Z'));
    const pending = deferred<undefined>();
    h.download.mockReturnValue(pending.promise);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    const busy = await screen.findByRole('button', { name: 'Preparing your file…' });
    expect(busy).toBeDisabled();
    expect(h.download).toHaveBeenCalledWith(
      '/api/v1/users/me/export',
      'nomarkup-data-export-2026-04-09.json',
    );

    pending.resolve(undefined);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your data export has been downloaded.',
    );
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("shows the gateway's reason when the export is refused", async () => {
    h.download.mockRejectedValue(new ApiError(429, JSON.stringify({ error: 'Export limit reached, try tomorrow' })));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Export limit reached, try tomorrow');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled();
  });

  it('clears a previous failure and success state on the next attempt', async () => {
    h.download.mockRejectedValueOnce(new Error(''));
    renderPage();
    const button = screen.getByRole('button', { name: 'Download my data' });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not prepare your data export. Please try again.',
    );

    h.download.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your data export has been downloaded.',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('AccountSettingsPage — delete friction gate', () => {
  it.each([
    ['nothing filled in', '', ''],
    ['a reason but no confirmation', 'other', ''],
    ['a confirmation but no reason', '', 'DELETE'],
    ['a lower-case confirmation', 'other', 'delete'],
    ['a padded confirmation', 'other', 'DELETE '],
  ])('keeps the button disabled with %s', (_label, reason, confirmation) => {
    renderPage();
    fillDeletionForm(reason, confirmation);
    expect(deleteButton()).toBeDisabled();
    fireEvent.click(deleteButton());
    expect(h.apiDelete).not.toHaveBeenCalled();
  });

  it('offers every documented leaving reason', () => {
    renderPage();
    const values = Array.from(
      screen.getByLabelText('Why are you leaving?').querySelectorAll('option'),
    ).map((o) => o.value);
    expect(values).toEqual([
      '',
      'no_longer_needed',
      'too_expensive',
      'switching_competitor',
      'privacy_concerns',
      'too_many_emails',
      'never_used',
      'other',
    ]);
  });
});

describe('AccountSettingsPage — requesting deletion', () => {
  it('sends the reason and confirmation, then shows the grace-period screen', async () => {
    const pending = deferred<{ created: boolean; grace_deadline: string; message: string }>();
    h.apiDelete.mockReturnValue(pending.promise);
    renderPage();
    fillDeletionForm('too_expensive');
    fireEvent.click(deleteButton());

    const submitting = await screen.findByRole('button', { name: 'Submitting...' });
    expect(submitting).toBeDisabled();
    expect(h.apiDelete).toHaveBeenCalledTimes(1);
    expect(h.apiDelete).toHaveBeenCalledWith('/api/v1/users/me', {
      reason: 'too_expensive',
      confirmation: 'DELETE',
    });

    pending.resolve({ created: true, grace_deadline: GRACE_DEADLINE, message: 'ok' });
    expect(await screen.findByText('Account deletion scheduled')).toBeInTheDocument();
    const formatted = new Date(GRACE_DEADLINE).toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    expect(screen.getByText(formatted)).toBeInTheDocument();
    // The settings cards are replaced, not stacked under the notice.
    expect(screen.queryByTestId('phone-otp-form')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('DELETE')).not.toBeInTheDocument();
  });

  it("shows the gateway's reason and re-enables the form when the API rejects", async () => {
    h.apiDelete.mockRejectedValue(
      new ApiError(409, JSON.stringify({ error: 'You have an active contract in escrow' })),
    );
    renderPage();
    fillDeletionForm();
    fireEvent.click(deleteButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('You have an active contract in escrow');
    expect(deleteButton()).toBeEnabled();
    expect(screen.queryByText('Account deletion scheduled')).not.toBeInTheDocument();
  });

  it('uses the fallback copy when an API error carries no usable body', async () => {
    h.apiDelete.mockRejectedValue(new ApiError(500, ''));
    renderPage();
    fillDeletionForm();
    fireEvent.click(deleteButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to request account deletion.');
  });

  it('asks to try again on a non-API failure and clears the error on retry', async () => {
    h.apiDelete.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderPage();
    fillDeletionForm();
    fireEvent.click(deleteButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to request account deletion. Please try again.');
    expect(alert).not.toHaveTextContent('Failed to fetch');

    const retry = deferred<{ created: boolean; grace_deadline: string; message: string }>();
    h.apiDelete.mockReturnValueOnce(retry.promise);
    fireEvent.click(deleteButton());
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(h.apiDelete).toHaveBeenCalledTimes(2);
    retry.resolve({ created: false, grace_deadline: GRACE_DEADLINE, message: 'already' });
    expect(await screen.findByText('Account deletion scheduled')).toBeInTheDocument();
  });
});

describe('AccountSettingsPage — grace period', () => {
  it('cancels the deletion and returns to the settings cards', async () => {
    await scheduleDeletion();
    h.apiPost.mockResolvedValue({ cancelled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Restore my account' }));

    // Restoring clears the deadline, so the normal page comes back.
    expect(await screen.findByTestId('phone-otp-form')).toBeInTheDocument();
    expect(h.apiPost).toHaveBeenCalledWith('/api/v1/users/me/restore', {});
    expect(screen.queryByText('Account deletion scheduled')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables Restore while the request is in flight', async () => {
    await scheduleDeletion();
    const pending = deferred<{ cancelled: boolean }>();
    h.apiPost.mockReturnValue(pending.promise);
    const restore = screen.getByRole('button', { name: 'Restore my account' });
    fireEvent.click(restore);
    await waitFor(() => {
      expect(restore).toBeDisabled();
    });
    pending.resolve({ cancelled: false });
    await waitFor(() => {
      expect(restore).toBeEnabled();
    });
  });

  it('reports when the server has no pending deletion to cancel', async () => {
    await scheduleDeletion();
    h.apiPost.mockResolvedValue({ cancelled: false });
    fireEvent.click(screen.getByRole('button', { name: 'Restore my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pending deletion request to cancel.',
    );
    // Still on the grace screen; nothing claims the account was restored.
    expect(screen.getByText('Account deletion scheduled')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it("shows the gateway's reason when restore is rejected", async () => {
    await scheduleDeletion();
    h.apiPost.mockRejectedValue(new ApiError(410, JSON.stringify({ message: 'Grace period has ended' })));
    fireEvent.click(screen.getByRole('button', { name: 'Restore my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Grace period has ended');
  });

  it('asks to try again when restore fails without an API error', async () => {
    await scheduleDeletion();
    h.apiPost.mockRejectedValue(new Error('socket hang up'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to cancel account deletion. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Restore my account' })).toBeEnabled();
  });

  it('signs out and then sends the user to the home page', async () => {
    await scheduleDeletion();
    const pending = deferred<undefined>();
    h.logout.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(h.logout).toHaveBeenCalledTimes(1);
    // No navigation until the session is actually cleared.
    expect(h.replace).not.toHaveBeenCalled();
    pending.resolve(undefined);
    await waitFor(() => {
      expect(h.replace).toHaveBeenCalledWith('/');
    });
  });
});
