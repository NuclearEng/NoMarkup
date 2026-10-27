import { render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
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

  it('never reads an access token from a JS-visible cookie (legacy oauth_access_token ignored)', async () => {
    parseJwtPayloadMock.mockReturnValue({ sub: 'u', email: 'e', roles: ['customer'] });
    document.cookie = 'oauth_access_token=tok-legacy; path=/';
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(setStateMock).toHaveBeenCalledWith({ isHydrating: false });
    });
    expect(setAccessTokenMock).not.toHaveBeenCalled();
    expect(parseJwtPayloadMock).not.toHaveBeenCalled();
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('clears legacy oauth handoff cookies on mount', async () => {
    document.cookie = 'oauth_access_token=tok-2; path=/';
    document.cookie = 'oauth_token_expires=9999; path=/';
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(document.cookie).not.toContain('oauth_access_token=');
    });
    expect(document.cookie).not.toContain('oauth_token_expires=');
  });

  it('after OAuth (has_session set) exchanges the HttpOnly refresh cookie via refreshToken()', async () => {
    document.cookie = 'has_session=1; path=/';
    document.cookie = 'oauth_access_token=tok-3; path=/';
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    });
    expect(setAccessTokenMock).not.toHaveBeenCalled();
  });

  it('only attempts restoration once per mount (StrictMode-style double effect)', async () => {
    document.cookie = 'has_session=1; path=/';
    const { rerender } = render(<AuthRestorer />);
    rerender(<AuthRestorer />);
    await waitFor(() => {
      expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    });
  });

  it('attempts restoration only once even under React StrictMode (effect runs twice)', async () => {
    document.cookie = 'has_session=1; path=/';
    render(
      <StrictMode>
        <AuthRestorer />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    });
  });

  it('returns null cookie value when no matching cookie exists (negative match path)', async () => {
    // Set an unrelated cookie so document.cookie is non-empty.
    document.cookie = 'unrelated=foo; path=/';
    // No has_session, no oauth_access_token → guard branch hit → setState({isHydrating:false}).
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(setStateMock).toHaveBeenCalledWith({ isHydrating: false });
    });
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });
});
