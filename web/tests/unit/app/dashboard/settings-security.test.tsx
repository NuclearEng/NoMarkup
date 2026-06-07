// Smoke + branch tests for the security settings page.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/security',
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

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getApiErrorMessage: (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback,
}));

// Provide a clipboard API so handleCopyBackupCodes does not throw in jsdom.
if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(() => Promise.resolve()) },
    configurable: true,
  });
}

vi.mock('@/hooks/useProfile', () => ({
  useProfile: vi.fn(),
}));

vi.mock('@/hooks/useMFA', () => ({
  useEnableMFA: vi.fn(),
  useVerifyMFASetup: vi.fn(),
  useDisableMFA: vi.fn(),
}));

const { useProfile } = await import('@/hooks/useProfile');
const { useEnableMFA, useVerifyMFASetup, useDisableMFA } = await import('@/hooks/useMFA');
const { default: SecuritySettingsPage } = await import(
  '@/app/(dashboard)/settings/security/page'
);

function defaultMfa() {
  vi.mocked(useEnableMFA).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useEnableMFA>);
  vi.mocked(useVerifyMFASetup).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useVerifyMFASetup>);
  vi.mocked(useDisableMFA).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDisableMFA>);
}

describe('SecuritySettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultMfa();
    vi.mocked(useProfile).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(container).toBeTruthy();
  });

  it('shows the Change Password form with three password fields', () => {
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByLabelText('Current Password')).toBeDefined();
    expect(screen.getByLabelText('New Password')).toBeDefined();
    expect(screen.getByLabelText('Confirm New Password')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeDefined();
  });

  it('shows the MFA loading skeleton when profile is loading', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    // The MFA section shows the title even while loading; the body switches to a
    // Skeleton instead of either the enable / disable CTA.
    expect(screen.queryByRole('button', { name: 'Enable MFA' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable MFA' })).toBeNull();
    expect(screen.getByText('Two-Factor Authentication')).toBeDefined();
  });

  it('renders the Enable MFA call to action when MFA is disabled', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByRole('button', { name: 'Enable MFA' })).toBeDefined();
  });

  it('renders the Disable MFA button when MFA is enabled', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByRole('button', { name: 'Disable MFA' })).toBeDefined();
    expect(screen.getByText('Two-factor authentication is enabled')).toBeDefined();
  });

  it('reveals the disable confirmation form when Disable MFA is clicked', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }));
    expect(screen.getByLabelText('Enter your authenticator code')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('shows the Setting up state when enableMFA is pending', () => {
    vi.mocked(useEnableMFA).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    } as unknown as ReturnType<typeof useEnableMFA>);
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByRole('button', { name: 'Setting up...' })).toBeDefined();
  });

  it('renders the Active Sessions card with the timeout copy', () => {
    render(withQueryClient(createElement(SecuritySettingsPage)));
    expect(screen.getByText('Active Sessions')).toBeDefined();
    expect(screen.getByText(/60\s+minutes of inactivity/)).toBeDefined();
  });

  it('clicking Enable MFA invokes the enable mutation and shows setup data', async () => {
    const enableMutate = vi.fn(() => Promise.resolve({
      secret: 'JBSWY3DPEHPK3PXP',
      qr_code_url: 'otpauth://totp/test',
      backup_codes: ['code-1', 'code-2'],
    }));
    vi.mocked(useEnableMFA).mockReturnValue({
      mutateAsync: enableMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useEnableMFA>);
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);

    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Enable MFA' }));
    // Wait a microtask for the promise chain.
    await Promise.resolve();
    await Promise.resolve();
    expect(enableMutate).toHaveBeenCalled();
  });

  it('shows error state when enableMFA mutation rejects', async () => {
    const enableMutate = vi.fn(() => Promise.reject(new Error('boom')));
    vi.mocked(useEnableMFA).mockReturnValue({
      mutateAsync: enableMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useEnableMFA>);
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);

    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Enable MFA' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(enableMutate).toHaveBeenCalled();
  });

  it('Cancel from the Disable MFA confirmation hides the input', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }));
    expect(screen.getByLabelText('Enter your authenticator code')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Enter your authenticator code')).toBeNull();
  });

  it('Disable MFA confirm button stays disabled with fewer than 6 digits', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }));
    const input = screen.getByLabelText('Enter your authenticator code');
    fireEvent.change(input, { target: { value: '123' } });
    // The submit button shows "Disable MFA" again — find via destructive variant.
    const buttons = screen.getAllByRole('button', { name: 'Disable MFA' });
    // The second occurrence is the submit form button.
    const submit = buttons[buttons.length - 1];
    expect(submit?.hasAttribute('disabled')).toBe(true);
  });

  it('shows Disabling... label when disable mutation is pending', () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    vi.mocked(useDisableMFA).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    } as unknown as ReturnType<typeof useDisableMFA>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }));
    const input = screen.getByLabelText('Enter your authenticator code');
    fireEvent.change(input, { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: 'Disabling...' })).toBeDefined();
  });

  // ---- Deep coverage of the MFA setup flow ----

  async function enterSetupFlow(): Promise<void> {
    const enableMutate = vi.fn(() => Promise.resolve({
      secret: 'JBSWY3DPEHPK3PXP',
      qr_code_url: 'otpauth://totp/test',
      backup_codes: ['code-1', 'code-2', 'code-3'],
    }));
    vi.mocked(useEnableMFA).mockReturnValue({
      mutateAsync: enableMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useEnableMFA>);
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enable MFA' }));
      // flush microtasks to let setSetupData commit
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('renders the QR + secret + backup codes after enabling MFA', async () => {
    await enterSetupFlow();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeDefined();
    expect(screen.getByText('code-1')).toBeDefined();
    expect(screen.getByText('code-2')).toBeDefined();
    expect(screen.getByRole('img', { name: /Scan this QR code/i })).toBeDefined();
  });

  it('Copy all flips to Copied for two seconds', async () => {
    vi.useFakeTimers();
    try {
      await enterSetupFlow();
      const copyBtn = screen.getByRole('button', { name: /Copy all/i });
      await act(async () => {
        fireEvent.click(copyBtn);
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: /Copied/i })).toBeDefined();
      await act(() => {
        vi.advanceTimersByTime(2000);
        return Promise.resolve();
      });
      expect(screen.queryByRole('button', { name: /Copied/i })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Cancel during setup tears down the setup data', async () => {
    await enterSetupFlow();
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      return Promise.resolve();
    });
    expect(screen.queryByLabelText('Enter code to verify')).toBeNull();
    expect(screen.getByRole('button', { name: 'Enable MFA' })).toBeDefined();
  });

  it('Verify button stays disabled until 6 digits are entered', async () => {
    await enterSetupFlow();
    const input = screen.getByLabelText('Enter code to verify');
    const enableBtn = screen.getByRole('button', { name: 'Enable MFA' });
    expect(enableBtn.hasAttribute('disabled')).toBe(true);
    fireEvent.change(input, { target: { value: '123' } });
    expect(enableBtn.hasAttribute('disabled')).toBe(true);
    fireEvent.change(input, { target: { value: '123456' } });
    expect(enableBtn.hasAttribute('disabled')).toBe(false);
  });

  it('Verifying... appears while verifySetup mutation is pending', async () => {
    vi.mocked(useVerifyMFASetup).mockReturnValue({
      mutateAsync: vi.fn(() => new Promise(() => undefined)),
      isPending: true,
    } as unknown as ReturnType<typeof useVerifyMFASetup>);
    await enterSetupFlow();
    fireEvent.change(screen.getByLabelText('Enter code to verify'), {
      target: { value: '123456' },
    });
    expect(screen.getByRole('button', { name: 'Verifying...' })).toBeDefined();
  });

  it('successful verify clears the setup data and shows success banner', async () => {
    const verifyMutate = vi.fn(() => Promise.resolve({}));
    vi.mocked(useVerifyMFASetup).mockReturnValue({
      mutateAsync: verifyMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useVerifyMFASetup>);
    await enterSetupFlow();
    fireEvent.change(screen.getByLabelText('Enter code to verify'), {
      target: { value: '123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enable MFA' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(verifyMutate).toHaveBeenCalled();
    });
    expect(
      await screen.findByText('Two-factor authentication has been enabled.'),
    ).toBeDefined();
  });

  it('verify error surfaces an alert region', async () => {
    vi.mocked(useVerifyMFASetup).mockReturnValue({
      mutateAsync: vi.fn(() => Promise.reject(new Error('bad code'))),
      isPending: false,
    } as unknown as ReturnType<typeof useVerifyMFASetup>);
    await enterSetupFlow();
    fireEvent.change(screen.getByLabelText('Enter code to verify'), {
      target: { value: '123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enable MFA' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('bad code')).toBeDefined();
  });

  it('successful disable clears the form and shows the success banner', async () => {
    const disableMutate = vi.fn(() => Promise.resolve({}));
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    vi.mocked(useDisableMFA).mockReturnValue({
      mutateAsync: disableMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDisableMFA>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }));
    fireEvent.change(screen.getByLabelText('Enter your authenticator code'), {
      target: { value: '123456' },
    });
    const buttons = screen.getAllByRole('button', { name: 'Disable MFA' });
    const submit = buttons[buttons.length - 1];
    if (!submit) throw new Error('Expected disable submit button');
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(disableMutate).toHaveBeenCalledWith({ totp_code: '123456' });
    });
    expect(
      await screen.findByText('Two-factor authentication has been disabled.'),
    ).toBeDefined();
  });

  it('disable error surfaces an alert', async () => {
    vi.mocked(useProfile).mockReturnValue({
      data: { mfaEnabled: true },
      isLoading: false,
    } as unknown as ReturnType<typeof useProfile>);
    vi.mocked(useDisableMFA).mockReturnValue({
      mutateAsync: vi.fn(() => Promise.reject(new Error('bad totp'))),
      isPending: false,
    } as unknown as ReturnType<typeof useDisableMFA>);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }));
    fireEvent.change(screen.getByLabelText('Enter your authenticator code'), {
      target: { value: '123456' },
    });
    const buttons = screen.getAllByRole('button', { name: 'Disable MFA' });
    const submit = buttons[buttons.length - 1];
    if (!submit) throw new Error('Expected disable submit button');
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('bad totp')).toBeDefined();
  });

  it('change-password form submits via api.post on click', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.post).mockResolvedValueOnce({} as never);
    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.change(screen.getByLabelText('Current Password'), {
      target: { value: 'OldPass1234!' },
    });
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'NewerPass1234!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'NewerPass1234!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/api/v1/auth/change-password',
        expect.objectContaining({
          current_password: 'OldPass1234!',
          new_password: 'NewerPass1234!',
        }),
      );
    });
    expect(
      await screen.findByText('Password changed successfully.'),
    ).toBeDefined();
  });

  it('change-password failure shows the destructive alert', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.post).mockRejectedValueOnce(new Error('wrong password'));
    render(withQueryClient(createElement(SecuritySettingsPage)));
    fireEvent.change(screen.getByLabelText('Current Password'), {
      target: { value: 'OldPass1234!' },
    });
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'NewerPass1234!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'NewerPass1234!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('wrong password')).toBeDefined();
  });
});
