import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '@/components/providers/AuthGuard';

const replaceMock = vi.fn();
const refreshTokenMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const { useAuthStore } = await import('@/stores/auth-store');

describe('AuthGuard', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    refreshTokenMock.mockReset();
    refreshTokenMock.mockResolvedValue(false);
    document.cookie = 'has_session=; path=/; max-age=0';
  });

  it('renders children when already authenticated', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      isAuthenticated: true,
      refreshToken: refreshTokenMock,
    });
    render(
      <AuthGuard>
        <div data-testid="content">protected</div>
      </AuthGuard>,
    );
    expect(screen.getByTestId('content').textContent).toBe('protected');
  });

  it('redirects to /login when no session cookie is present', async () => {
    vi.mocked(useAuthStore).mockReturnValue({
      isAuthenticated: false,
      refreshToken: refreshTokenMock,
    });
    render(
      <AuthGuard>
        <div data-testid="content">protected</div>
      </AuthGuard>,
    );
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/login');
    });
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('attempts refreshToken when session sentinel cookie is present', async () => {
    document.cookie = 'has_session=1; path=/';
    refreshTokenMock.mockResolvedValue(true);
    vi.mocked(useAuthStore).mockReturnValue({
      isAuthenticated: false,
      refreshToken: refreshTokenMock,
    });
    render(
      <AuthGuard>
        <div data-testid="content">protected</div>
      </AuthGuard>,
    );
    await waitFor(() => {
      expect(refreshTokenMock).toHaveBeenCalled();
    });
  });

  it('redirects to /login when refresh fails', async () => {
    document.cookie = 'has_session=1; path=/';
    refreshTokenMock.mockResolvedValue(false);
    vi.mocked(useAuthStore).mockReturnValue({
      isAuthenticated: false,
      refreshToken: refreshTokenMock,
    });
    render(
      <AuthGuard>
        <div data-testid="content">protected</div>
      </AuthGuard>,
    );
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/login');
    });
  });
});
