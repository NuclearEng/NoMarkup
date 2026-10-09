import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { postUnauthed: vi.fn() },
}));

const { useSearchParams } = await import('next/navigation');
const { api } = await import('@/lib/api');
const { ResetPasswordContent } = await import(
  '@/components/forms/ResetPasswordContent'
);

const useSearchParamsMock = vi.mocked(useSearchParams);

function makeParams(token: string | null): URLSearchParams {
  const sp = new URLSearchParams();
  if (token != null) sp.set('token', token);
  return sp;
}

describe('ResetPasswordContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the invalid-token state when no token in URL', () => {
    useSearchParamsMock.mockReturnValue(
      makeParams(null) as unknown as ReturnType<typeof useSearchParams>,
    );
    render(createElement(ResetPasswordContent));
    expect(screen.getByText('Invalid reset link')).toBeDefined();
  });

  it('renders the password form when a token is present', () => {
    useSearchParamsMock.mockReturnValue(
      makeParams('tok') as unknown as ReturnType<typeof useSearchParams>,
    );
    render(createElement(ResetPasswordContent));
    expect(screen.getByLabelText(/New password/)).toBeDefined();
    expect(screen.getByLabelText(/Confirm password/)).toBeDefined();
  });

  it('shows the success state after resetting', async () => {
    useSearchParamsMock.mockReturnValue(
      makeParams('tok') as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(api.postUnauthed).mockResolvedValue({});

    const user = userEvent.setup();
    render(createElement(ResetPasswordContent));

    await user.type(screen.getByLabelText(/New password/), 'NewPassword123!');
    await user.type(screen.getByLabelText(/Confirm password/), 'NewPassword123!');
    await user.click(screen.getByRole('button', { name: /Reset password/ }));

    await waitFor(() => {
      expect(api.postUnauthed).toHaveBeenCalledWith('/api/v1/auth/reset-password', {
        token: 'tok',
        new_password: 'NewPassword123!',
      });
    });
    expect(await screen.findByText('Password reset')).toBeDefined();
  });

  it('shows error when reset fails', async () => {
    useSearchParamsMock.mockReturnValue(
      makeParams('tok') as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(api.postUnauthed).mockRejectedValue(new Error('expired'));

    const user = userEvent.setup();
    render(createElement(ResetPasswordContent));

    await user.type(screen.getByLabelText(/New password/), 'NewPassword123!');
    await user.type(screen.getByLabelText(/Confirm password/), 'NewPassword123!');
    await user.click(screen.getByRole('button', { name: /Reset password/ }));

    expect(await screen.findByText(/Failed to reset password/)).toBeDefined();
  });
});
