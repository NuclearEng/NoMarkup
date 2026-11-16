import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '@/components/providers/AuthGuard';

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/orders',
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const { useAuthStore } = await import('@/stores/auth-store');

interface MockState {
  isAuthenticated: boolean;
  isHydrating: boolean;
}

function setStore(state: MockState) {
  vi.mocked(useAuthStore).mockImplementation(((selector?: unknown) => {
    if (typeof selector === 'function') {
      return (selector as (s: unknown) => unknown)(state);
    }
    return state;
  }) as unknown as typeof useAuthStore);
}

describe('AuthGuard', () => {
  beforeEach(() => {
    replaceMock.mockReset();
  });

  it('renders children when authenticated and hydration is complete', () => {
    setStore({ isAuthenticated: true, isHydrating: false });
    render(
      <AuthGuard>
        <div data-testid="content">protected</div>
      </AuthGuard>,
    );
    expect(screen.getByTestId('content').textContent).toBe('protected');
  });

  it('shows loader while AuthRestorer is still hydrating (does NOT call refresh itself)', () => {
    setStore({ isAuthenticated: false, isHydrating: true });
    render(
      <AuthGuard>
        <div data-testid="content">protected</div>
      </AuthGuard>,
    );
    expect(screen.queryByTestId('content')).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('redirects to /login when hydration finishes and user is unauthenticated', async () => {
    setStore({ isAuthenticated: false, isHydrating: false });
    render(
      <AuthGuard>
        <div data-testid="content">protected</div>
      </AuthGuard>,
    );
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/login?next=%2Forders');
    });
  });

  it('does not redirect when authenticated', () => {
    setStore({ isAuthenticated: true, isHydrating: false });
    render(
      <AuthGuard>
        <div data-testid="content">protected</div>
      </AuthGuard>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
