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

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({}),
}));

vi.mock('@/components/auth/PasskeySignInButton', () => ({
  PasskeySignInButton: () => null,
}));

const { LoginForm } = await import('@/components/forms/LoginForm');
const { MFARequiredError } = await import('@/stores/auth-store');

const OAUTH_MFA_CHALLENGE_KEY = 'nomarkup:oauth_mfa_challenge';
const POST_LOGIN_NEXT_KEY = 'nomarkup:post_login_next';

function clearAuthCookies(): void {
  document.cookie = 'oauth_mfa_challenge=; path=/; max-age=0; samesite=strict';
  document.cookie = 'oauth_mfa_pending=; path=/; max-age=0; samesite=strict';
}

function mockExchange(token: string) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ mfa_challenge_token: token }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock = new URLSearchParams();
    sessionStorage.clear();
    clearAuthCookies();
    vi.unstubAllGlobals();
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

  it('drops the OAuth MFA challenge from storage and pending flag on Back', async () => {
    mockExchange('oauth-back');
    document.cookie = 'oauth_mfa_pending=1; path=/';
    const user = userEvent.setup();
    render(createElement(LoginForm));
    await screen.findByText(/Two-factor authentication/i);
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBe('oauth-back');
    await user.click(screen.getByRole('button', { name: /Back to login/i }));
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeDefined();
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain('oauth_mfa_pending=');
  });

  it('redeems the HttpOnly challenge via POST exchange when the pending flag is set', async () => {
    const fetchMock = mockExchange('oauth-chal-1');
    document.cookie = 'oauth_mfa_pending=1; path=/';
    render(createElement(LoginForm));
    expect(await screen.findByText(/Two-factor authentication/i)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/oauth/mfa-challenge');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBe('oauth-chal-1');
    expect(document.cookie).not.toContain('oauth_mfa_pending=');
  });

  it('does not call the exchange without the pending flag', async () => {
    const fetchMock = mockExchange('unused');
    render(createElement(LoginForm));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Two-factor authentication/i)).toBeNull();
  });

  it('ignores (and clears) a legacy JS-readable oauth_mfa_challenge cookie', async () => {
    const fetchMock = mockExchange('unused');
    document.cookie = 'oauth_mfa_challenge=legacy-chal; path=/';
    render(createElement(LoginForm));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Two-factor authentication/i)).toBeNull();
    expect(document.cookie).not.toContain('oauth_mfa_challenge=');
  });

  it('stays on the password form when the exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    document.cookie = 'oauth_mfa_pending=1; path=/';
    render(createElement(LoginForm));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/Two-factor authentication/i)).toBeNull();
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBeNull();
  });

  it('restores the OAuth MFA challenge from sessionStorage after remount', async () => {
    const fetchMock = mockExchange('oauth-chal-2');
    document.cookie = 'oauth_mfa_pending=1; path=/';
    const { unmount } = render(createElement(LoginForm));
    expect(await screen.findByText(/Two-factor authentication/i)).toBeDefined();
    unmount();
    render(createElement(LoginForm));
    expect(await screen.findByText(/Two-factor authentication/i)).toBeDefined();
    expect(sessionStorage.getItem(OAUTH_MFA_CHALLENGE_KEY)).toBe('oauth-chal-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
