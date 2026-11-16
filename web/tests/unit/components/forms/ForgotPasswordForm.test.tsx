import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {
    postUnauthed: vi.fn(),
  },
}));

const { api } = await import('@/lib/api');
const { ForgotPasswordForm } = await import('@/components/forms/ForgotPasswordForm');

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form with email input and submit button', () => {
    render(createElement(ForgotPasswordForm));
    expect(screen.getByLabelText(/Email/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Send reset link/ })).toBeDefined();
  });

  it('shows validation error for invalid email', async () => {
    const user = userEvent.setup();
    render(createElement(ForgotPasswordForm));

    await user.type(screen.getByLabelText(/Email/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /Send reset link/ }));

    expect(await screen.findByText(/Invalid email/)).toBeDefined();
    expect(api.postUnauthed).not.toHaveBeenCalled();
  });

  it('submits to /request-password-reset and shows success state', async () => {
    const user = userEvent.setup();
    vi.mocked(api.postUnauthed).mockResolvedValue({});

    render(createElement(ForgotPasswordForm));
    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.click(screen.getByRole('button', { name: /Send reset link/ }));

    await waitFor(() => {
      expect(api.postUnauthed).toHaveBeenCalledWith('/api/v1/auth/request-password-reset', {
        email: 'user@example.com',
      });
    });
    expect(await screen.findByText(/Check your email/)).toBeDefined();
  });

  it('shows error message when the request fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.postUnauthed).mockRejectedValue(new Error('500'));

    render(createElement(ForgotPasswordForm));
    await user.type(screen.getByLabelText(/Email/), 'user@example.com');
    await user.click(screen.getByRole('button', { name: /Send reset link/ }));

    expect(await screen.findByText(/Failed to send reset link/)).toBeDefined();
  });
});
