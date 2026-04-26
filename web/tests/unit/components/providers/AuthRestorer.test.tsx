import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthRestorer } from '@/components/providers/AuthRestorer';

const refreshTokenMock = vi.fn();
const setStateMock = vi.fn();
const setAccessTokenMock = vi.fn();
const parseJwtPayloadMock = vi.fn();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { refreshToken: typeof refreshTokenMock }) => unknown) =>
      selector({ refreshToken: refreshTokenMock }),
    { setState: (state: unknown) => { setStateMock(state); } },
  ),
}));

vi.mock('@/lib/auth', () => ({
  parseJwtPayload: (token: string) => parseJwtPayloadMock(token) as unknown,
  setAccessToken: (token: string) => { setAccessTokenMock(token); },
}));

function clearCookies(): void {
  document.cookie = 'has_session=; path=/; max-age=0';
  document.cookie = 'oauth_access_token=; path=/; max-age=0';
  document.cookie = 'oauth_token_expires=; path=/; max-age=0';
}

describe('AuthRestorer', () => {
  beforeEach(() => {
    refreshTokenMock.mockReset();
    setStateMock.mockReset();
    setAccessTokenMock.mockReset();
    parseJwtPayloadMock.mockReset();
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearCookies();
  });

  it('renders nothing (returns null)', () => {
    const { container } = render(<AuthRestorer />);
    expect(container.firstChild).toBeNull();
  });

  it('marks hydrating false and skips refresh when no session/oauth cookies exist', async () => {
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(setStateMock).toHaveBeenCalledWith({ isHydrating: false });
    });
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('calls refreshToken when has_session cookie is set', async () => {
    document.cookie = 'has_session=1; path=/';
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(refreshTokenMock).toHaveBeenCalled();
    });
    expect(setAccessTokenMock).not.toHaveBeenCalled();
  });

  it('hydrates auth store from oauth_access_token cookie when present', async () => {
    parseJwtPayloadMock.mockReturnValue({
      sub: 'user-1',
      email: 'oauth@example.com',
      roles: ['customer'],
    });
    document.cookie = 'oauth_access_token=token-abc; path=/';
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(setAccessTokenMock).toHaveBeenCalledWith('token-abc');
    });
    await waitFor(() => {
      expect(setStateMock).toHaveBeenCalled();
    });
    const lastCall = setStateMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(lastCall).toBeDefined();
    expect((lastCall as { isAuthenticated: boolean }).isAuthenticated).toBe(true);
    expect((lastCall as { accessToken: string }).accessToken).toBe('token-abc');
    // Refresh should NOT be invoked when oauth path was used
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('does not hydrate when oauth token cannot be parsed', async () => {
    parseJwtPayloadMock.mockReturnValue(null);
    document.cookie = 'oauth_access_token=bad-token; path=/';
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(setAccessTokenMock).toHaveBeenCalledWith('bad-token');
    });
    // setState may be invoked elsewhere — but never with isAuthenticated:true
    const authedCall = setStateMock.mock.calls.find((args) => {
      const arg = args[0] as { isAuthenticated?: boolean } | undefined;
      return arg?.isAuthenticated === true;
    });
    expect(authedCall).toBeUndefined();
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('only attempts restoration once per mount (StrictMode-style double effect)', async () => {
    document.cookie = 'has_session=1; path=/';
    const { rerender } = render(<AuthRestorer />);
    rerender(<AuthRestorer />);
    await waitFor(() => {
      expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    });
  });
});
