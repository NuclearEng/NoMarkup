import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthRestorer } from '@/components/providers/AuthRestorer';

const refreshTokenMock = vi.fn();
const setStateMock = vi.fn();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { refreshToken: typeof refreshTokenMock }) => unknown) =>
      selector({ refreshToken: refreshTokenMock }),
    { setState: (state: unknown) => { setStateMock(state); } },
  ),
}));

vi.mock('@/lib/auth', () => ({
  parseJwtPayload: vi.fn(() => null),
  setAccessToken: vi.fn(),
}));

describe('AuthRestorer', () => {
  beforeEach(() => {
    refreshTokenMock.mockReset();
    setStateMock.mockReset();
    // Reset cookies
    document.cookie = 'has_session=; path=/; max-age=0';
    document.cookie = 'oauth_access_token=; path=/; max-age=0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing (returns null)', () => {
    const { container } = render(<AuthRestorer />);
    expect(container.firstChild).toBeNull();
  });

  it('does not call refreshToken when no session/oauth cookies exist', async () => {
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(setStateMock).toHaveBeenCalled();
    });
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('calls refreshToken when has_session cookie is set', async () => {
    document.cookie = 'has_session=1; path=/';
    render(<AuthRestorer />);
    await waitFor(() => {
      expect(refreshTokenMock).toHaveBeenCalled();
    });
  });
});
