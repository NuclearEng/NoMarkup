// Regression: ISSUE-002 — AuthGuard rendered a bare white spinner for
// unauthenticated users hitting a protected route, then called
// /api/v1/auth/refresh (which always 400s without a session).
// Found by /qa on 2026-04-17.
// Report: .gstack/qa-reports/qa-report-localhost-2026-04-17.md

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshTokenMock = vi.fn();
const routerReplaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector?: unknown) => {
    const state = {
      isAuthenticated: false,
      isHydrating: false,
      refreshToken: refreshTokenMock,
    };
    if (typeof selector === 'function') {
      return (selector as (s: unknown) => unknown)(state);
    }
    return state;
  },
}));

import { AuthGuard } from '@/components/providers/AuthGuard';

function setCookie(raw: string): void {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => raw,
    set: () => {},
  });
}

describe('AuthGuard — ISSUE-002 regression', () => {
  beforeEach(() => {
    refreshTokenMock.mockReset().mockResolvedValue(false);
    routerReplaceMock.mockReset();
  });

  afterEach(() => {
    setCookie('');
  });

  it('skips refreshToken and redirects to /login when has_session is absent', () => {
    setCookie('');
    render(
      <AuthGuard>
        <div>secret</div>
      </AuthGuard>,
    );
    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledWith('/login');
  });

  it('renders a branded dark loader while redirect is in flight', () => {
    setCookie('');
    render(
      <AuthGuard>
        <div>secret</div>
      </AuthGuard>,
    );

    // The loader is the full-viewport dark shell, not a bare spinner on the
    // default white body. The shell used to be a raw `bg-[#070b14]` hex; it is
    // now the `dark` + `bg-background` semantic token pair (CLAUDE.md §4: no
    // raw hex in components), so assert the tokens, not the literal colour.
    const loader = screen.getByRole('status');
    expect(loader).toHaveClass('dark');
    expect(loader).toHaveClass('bg-background');
    expect(loader).toHaveClass('min-h-screen');

    // …and it must announce itself rather than showing a silent blank frame.
    expect(loader).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/Loading your dashboard/i)).toBeInTheDocument();

    // The guarded content must NOT be in the tree while unauthenticated.
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('never calls refreshToken itself — that is delegated to AuthRestorer to avoid racing the single-use refresh token', () => {
    // The original ISSUE-002 fix prevented AuthGuard from calling refresh when
    // no session sentinel was present. The follow-up refactor (see AuthGuard
    // docstring) moved refresh to AuthRestorer entirely so the two never race
    // on the single-use refresh token. Either way, AuthGuard must never call
    // refreshToken from within its own effect.
    setCookie('has_session=1');
    render(
      <AuthGuard>
        <div>secret</div>
      </AuthGuard>,
    );
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });
});
