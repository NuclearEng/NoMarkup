import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const pushMock = vi.fn();
const loginMock = vi.fn();
const completeMFAMock = vi.fn();
let searchParamsMock = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => searchParamsMock,
}));

vi.mock('@/stores/auth-store', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/stores/auth-store');
  return {
    ...actual,
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        login: loginMock,
        completeMFALogin: completeMFAMock,
        user: null,
        isAuthenticated: false,
      }),
  };
});

vi.mock('@/components/auth/oauth-buttons', () => ({
  OAuthButtons: () => null,
  OAuthDivider: () => null,
}));

const { LoginForm } = await import('@/components/forms/LoginForm');
const { MFARequiredError } = await import('@/stores/auth-store');

const OAUTH_MFA_CHALLENGE_KEY = 'nomarkup:oauth_mfa_challenge';
const POST_LOGIN_NEXT_KEY = 'nomarkup:post_login_next';

function clearAuthCookies(): void {
  document.cookie = 'oauth_mfa_challenge=; path=/; max-age=0; samesite=strict';
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock = new URLSearchParams();
    sessionStorage.clear();
    clearAuthCookies();
  });

  it('renders email, password and submit', () => {
    render(createElement(LoginForm));
    expect(screen.getByLabelText(/Email/)).toBeDefined();
    expect(screen.getByLabelText(/Password/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeDefined();
  });

  it('surfaces gateway OAuth error query params', async () => {
    searchParamsMock = new URLSearchParams('error=google_not_configured');
    render(createElement(LoginForm));
    expect(
      await screen.findByText(/Google sign-in is not configured/i),
    ).toBeDefined();
  });

  it('shows validation errors for an invalid email', async () => {
    const user = userEvent.setup();
    render(createElement(LoginForm));

    await user.type(screen.getByLabelText(/Email/), 'not-email');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    expect(await screen.findByText(/Invalid email/)).toBeDefined();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('logs the user in and redirects on success', async () => {
    loginMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(createElement(LoginForm));

    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('user@example.com', 'Password123!');
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('redirects to a same-origin next path after login', async () => {
    searchParamsMock = new URLSearchParams('next=/orders');
    loginMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(createElement(LoginForm));

    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/orders');
    });
  });

  it('ignores an absolute next URL and stays on /dashboard', async () => {
    searchParamsMock = new URLSearchParams('next=https://evil.example/phish');
    loginMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(createElement(LoginForm));

    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows the error message when login throws', async () => {
    loginMock.mockRejectedValue(new Error('Bad credentials'));

    const user = userEvent.setup();
    render(createElement(LoginForm));

    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    expect(await screen.findByText('Bad credentials')).toBeDefined();
  });

  it('shows generic message when login throws non-Error value', async () => {
    loginMock.mockRejectedValue('string thrown');
    const user = userEvent.setup();
    render(createElement(LoginForm));
    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByText('Login failed')).toBeDefined();
  });

  it('renders a forgot-password link', () => {
    render(createElement(LoginForm));
    expect(screen.getByRole('link', { name: /Forgot password/ })).toBeDefined();
  });

  it('renders a register link', () => {
    render(createElement(LoginForm));
    expect(screen.getByRole('link', { name: /Create one/ })).toBeDefined();
  });

  it('shows the MFA step when login throws MFARequiredError', async () => {
    loginMock.mockRejectedValue(new MFARequiredError('user-id-1', 'challenge-tok-1'));
    const user = userEvent.setup();
    render(createElement(LoginForm));
    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByText(/Two-factor authentication/i)).toBeDefined();
    expect(screen.getByLabelText(/Verification code/)).toBeDefined();
  });

  it('disables the verify button until the code is at least 6 chars', async () => {
    loginMock.mockRejectedValue(new MFARequiredError('user-id-1', 'tok'));
    const user = userEvent.setup();
    render(createElement(LoginForm));
    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    const verifyBtn = await screen.findByRole('button', { name: /Verify/ });
    expect((verifyBtn as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(/Verification code/), '12345');
    expect((verifyBtn as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(/Verification code/), '6');
    expect((verifyBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('completes MFA login and redirects on success', async () => {
    loginMock.mockRejectedValue(new MFARequiredError('user-id-1', 'tok-99'));
    completeMFAMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(createElement(LoginForm));
    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    const code = await screen.findByLabelText(/Verification code/);
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: /^Verify$/ }));
    await waitFor(() => {
      expect(completeMFAMock).toHaveBeenCalledWith('tok-99', '123456');
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows MFA error message when completeMFALogin throws', async () => {
    loginMock.mockRejectedValue(new MFARequiredError('user-id-1', 'tok-99'));
    completeMFAMock.mockRejectedValue(new Error('Invalid code'));
    const user = userEvent.setup();
    render(createElement(LoginForm));
    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    const code = await screen.findByLabelText(/Verification code/);
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: /^Verify$/ }));
    expect(await screen.findByText('Invalid code')).toBeDefined();
  });

  it('returns to login screen when Back to login is clicked from MFA step', async () => {
    loginMock.mockRejectedValue(new MFARequiredError('uid', 'ct'));
    const user = userEvent.setup();
    render(createElement(LoginForm));
    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    await screen.findByText(/Two-factor authentication/i);
    await user.click(screen.getByRole('button', { name: /Back to login/i }));
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeDefined();
  });

  it('drops the OAuth MFA challenge from storage and cookie on Back', async () => {
    document.cookie = 'oauth_mfa_challenge=oauth-back; path=/';
    const user = userEvent.setup();
    render(createElement(LoginForm));
    await screen.findByText(/Two-factor authentication/i);
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBe('oauth-back');
    await user.click(screen.getByRole('button', { name: /Back to login/i }));
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeDefined();
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain('oauth_mfa_challenge=');
  });

  it('opens MFA from the oauth_mfa_challenge cookie and copies it to sessionStorage', async () => {
    document.cookie = 'oauth_mfa_challenge=oauth-chal-1; path=/';
    render(createElement(LoginForm));
    expect(await screen.findByText(/Two-factor authentication/i)).toBeDefined();
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBe('oauth-chal-1');
  });

  it('restores the OAuth MFA challenge from sessionStorage after remount', async () => {
    document.cookie = 'oauth_mfa_challenge=oauth-chal-2; path=/';
    const { unmount } = render(createElement(LoginForm));
    expect(await screen.findByText(/Two-factor authentication/i)).toBeDefined();
    unmount();
    render(createElement(LoginForm));
    expect(await screen.findByText(/Two-factor authentication/i)).toBeDefined();
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBe('oauth-chal-2');
  });

  it('uses a raw oauth_mfa_challenge cookie when decodeURIComponent fails', async () => {
    document.cookie = 'oauth_mfa_challenge=%E0%A4%A; path=/';
    render(createElement(LoginForm));
    expect(await screen.findByText(/Two-factor authentication/i)).toBeDefined();
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBe('%E0%A4%A');
  });

  it('redirects to stored post-login next after OAuth MFA when query next is absent', async () => {
    sessionStorage.setItem(POST_LOGIN_NEXT_KEY, '/orders');
    sessionStorage.setItem(OAUTH_MFA_CHALLENGE_KEY, 'tok-stored');
    completeMFAMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(createElement(LoginForm));
    const code = await screen.findByLabelText(/Verification code/);
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: /^Verify$/ }));
    await waitFor(() => {
      expect(completeMFAMock).toHaveBeenCalledWith('tok-stored', '123456');
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/orders');
    });
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(POST_LOGIN_NEXT_KEY)).toBeNull();
  });
});
