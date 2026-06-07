import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/register',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getPublic: vi.fn(),
    postUnauthed: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getApiErrorMessage: (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback,
}));

const registerMock = vi.fn();
vi.mock('@/stores/auth-store', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/stores/auth-store');
  return {
    ...actual,
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        register: registerMock,
        user: null,
        isAuthenticated: false,
      }),
  };
});

const enableRoleMutateAsyncMock = vi.fn();
vi.mock('@/hooks/useProfile', () => ({
  useEnableRole: () => ({
    mutateAsync: enableRoleMutateAsyncMock,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/components/auth/oauth-buttons', () => ({
  OAuthButtons: () => null,
  OAuthDivider: () => null,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const { RegisterForm } = await import('@/components/forms/RegisterForm');

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMock.mockReset();
    enableRoleMutateAsyncMock.mockReset();
  });

  it('renders all fields, intent picker, and submit button', () => {
    render(createElement(RegisterForm));

    expect(screen.getByPlaceholderText('Your name')).toBeDefined();
    expect(screen.getByPlaceholderText('you@example.com')).toBeDefined();
    expect(screen.getByPlaceholderText('Create a password')).toBeDefined();
    expect(screen.getByPlaceholderText('Confirm your password')).toBeDefined();
    expect(screen.getByRole('button', { name: /I need work done/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /I offer services/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Create account/ })).toBeDefined();
  });

  it('switches the submit label when the provider intent is chosen', async () => {
    const user = userEvent.setup();
    render(createElement(RegisterForm));

    await user.click(screen.getByRole('button', { name: /I offer services/ }));
    expect(screen.getByRole('button', { name: /Create provider account/ })).toBeDefined();
  });

  it('shows a validation error when the passwords do not match', async () => {
    const user = userEvent.setup();
    const { container } = render(createElement(RegisterForm));

    await user.type(screen.getByPlaceholderText('Your name'), 'New User');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'new@example.com');
    await user.type(screen.getByPlaceholderText('Create a password'), 'StrongPass1!');
    await user.type(screen.getByPlaceholderText('Confirm your password'), 'DifferentPass1!');

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    expect(await screen.findByText(/Passwords do not match/)).toBeDefined();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('renders a password strength indicator once a password is typed', async () => {
    const user = userEvent.setup();
    render(createElement(RegisterForm));

    await user.type(screen.getByPlaceholderText('Create a password'), 'StrongPass1!');
    expect(await screen.findByText(/Strong|Very strong|Good|Fair|Weak/)).toBeDefined();
  });

  it('registers a customer and redirects to /dashboard on success', async () => {
    registerMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { container } = render(createElement(RegisterForm));

    await user.type(screen.getByPlaceholderText('Your name'), 'Cust User');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'cust@example.com');
    await user.type(screen.getByPlaceholderText('Create a password'), 'StrongPass1!');
    await user.type(screen.getByPlaceholderText('Confirm your password'), 'StrongPass1!');

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith(
        'cust@example.com',
        'StrongPass1!',
        'Cust User',
      );
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
    expect(enableRoleMutateAsyncMock).not.toHaveBeenCalled();
  });

  it('enables the provider role and redirects to /provider/onboarding when the provider intent is chosen', async () => {
    registerMock.mockResolvedValue(undefined);
    enableRoleMutateAsyncMock.mockResolvedValue({});
    const user = userEvent.setup();
    const { container } = render(createElement(RegisterForm));

    await user.click(screen.getByRole('button', { name: /I offer services/ }));
    await user.type(screen.getByPlaceholderText('Your name'), 'Pro User');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'pro@example.com');
    await user.type(screen.getByPlaceholderText('Create a password'), 'StrongPass1!');
    await user.type(screen.getByPlaceholderText('Confirm your password'), 'StrongPass1!');

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(enableRoleMutateAsyncMock).toHaveBeenCalledWith('provider');
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/provider/onboarding');
    });
  });

  it('surfaces the error message when registration throws', async () => {
    registerMock.mockRejectedValue(new Error('Email already taken'));
    const user = userEvent.setup();
    const { container } = render(createElement(RegisterForm));

    await user.type(screen.getByPlaceholderText('Your name'), 'New User');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'new@example.com');
    await user.type(screen.getByPlaceholderText('Create a password'), 'StrongPass1!');
    await user.type(screen.getByPlaceholderText('Confirm your password'), 'StrongPass1!');

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);

    expect(await screen.findByText('Email already taken')).toBeDefined();
  });
});
