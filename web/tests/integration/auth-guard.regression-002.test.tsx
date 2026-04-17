// Regression: ISSUE-002 — AuthGuard rendered a bare white spinner for
// unauthenticated users hitting a protected route, then called
// /api/v1/auth/refresh (which always 400s without a session).
// Found by /qa on 2026-04-17.
// Report: .gstack/qa-reports/qa-report-localhost-2026-04-17.md

import { render } from '@testing-library/react';
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
  useAuthStore: () => ({
    isAuthenticated: false,
    refreshToken: refreshTokenMock,
  }),
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
    const { container } = render(
      <AuthGuard>
        <div>secret</div>
      </AuthGuard>,
    );
    // The loader lives on the dark shell, not the default white body.
    const loader = container.querySelector('.bg-\\[\\#070b14\\]');
    expect(loader).not.toBeNull();
  });

  it('calls refreshToken when has_session=1 is present', () => {
    setCookie('has_session=1');
    render(
      <AuthGuard>
        <div>secret</div>
      </AuthGuard>,
    );
    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
  });
});
