// Regression: ISSUE-001 — AuthRestorer called /api/v1/auth/refresh on every
// public page load, logging a 400 "refresh token required" for anonymous users.
// Found by /qa on 2026-04-17.
// Report: .gstack/qa-reports/qa-report-localhost-2026-04-17.md

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshTokenMock = vi.fn();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ refreshToken: refreshTokenMock }),
    { setState: vi.fn() },
  ),
}));

vi.mock('@/lib/auth', () => ({
  parseJwtPayload: vi.fn(),
  setAccessToken: vi.fn(),
}));

import { AuthRestorer } from '@/components/providers/AuthRestorer';

function setCookie(raw: string): void {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => raw,
    set: () => {},
  });
}

describe('AuthRestorer — ISSUE-001 regression', () => {
  beforeEach(() => {
    refreshTokenMock.mockReset().mockResolvedValue(false);
  });

  afterEach(() => {
    setCookie('');
  });

  it('skips refreshToken when no has_session sentinel is present', () => {
    setCookie('');
    render(<AuthRestorer />);
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('skips refreshToken when an unrelated cookie is set but has_session is absent', () => {
    setCookie('analytics_id=abc123');
    render(<AuthRestorer />);
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('calls refreshToken when has_session=1 is present', async () => {
    setCookie('has_session=1');
    render(<AuthRestorer />);
    await Promise.resolve();
    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
  });
});
