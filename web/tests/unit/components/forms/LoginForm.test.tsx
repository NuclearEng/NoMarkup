import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const pushMock = vi.fn();
const loginMock = vi.fn();
const completeMFAMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
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

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email, password and submit', () => {
    render(createElement(LoginForm));
    expect(screen.getByLabelText(/Email/)).toBeDefined();
    expect(screen.getByLabelText(/Password/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeDefined();
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

  it('shows the error message when login throws', async () => {
    loginMock.mockRejectedValue(new Error('Bad credentials'));

    const user = userEvent.setup();
    render(createElement(LoginForm));

    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.type(screen.getByLabelText(/Password/), 'Password123!');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    expect(await screen.findByText('Bad credentials')).toBeDefined();
  });

  it('renders a forgot-password link', () => {
    render(createElement(LoginForm));
    expect(screen.getByRole('link', { name: /Forgot password/ })).toBeDefined();
  });
});
