import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MFARequiredError, useAuthStore } from '@/stores/auth-store';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
    postUnauthed: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`API error ${String(status)}: ${body}`);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  },
}));

// Mock the auth module
vi.mock('@/lib/auth', () => ({
  setAccessToken: vi.fn(),
  clearTokens: vi.fn(),
  parseJwtPayload: vi.fn(),
}));

// Import mocked modules after mocking
const { api, ApiError } = await import('@/lib/api');
const { setAccessToken, clearTokens, parseJwtPayload } = await import(
  '@/lib/auth'
);

// Helper to create a mock JWT with encoded payload
function createMockJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = 'mock-signature';
  return `${header}.${body}.${signature}`;
}

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with no user', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
    });

    it('starts with no access token', () => {
      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
    });

    it('starts as not authenticated', () => {
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('login', () => {
    it('sets user and token on successful login with JWT payload', async () => {
      const mockToken = createMockJwt({
        sub: 'user-123',
        email: 'test@example.com',
        roles: ['customer'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        user_id: 'user-123',
        access_token: mockToken,
        access_token_expires_at: new Date(
          Date.now() + 3600000,
        ).toISOString(),
        mfa_required: false,
        mfa_challenge_token: null,
      });

      vi.mocked(parseJwtPayload).mockReturnValueOnce({
        sub: 'user-123',
        email: 'test@example.com',
        roles: ['customer'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      await useAuthStore
        .getState()
        .login('test@example.com', 'StrongP@ss1');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.accessToken).toBe(mockToken);
      expect(state.user).not.toBeNull();
      expect(state.user?.email).toBe('test@example.com');
      expect(state.user?.id).toBe('user-123');
      expect(setAccessToken).toHaveBeenCalledWith(mockToken);
    });

    it('falls back to email from input when JWT parse fails', async () => {
      const mockToken = 'invalid-jwt';

      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        user_id: 'user-456',
        access_token: mockToken,
        access_token_expires_at: new Date(
          Date.now() + 3600000,
        ).toISOString(),
        mfa_required: false,
        mfa_challenge_token: null,
      });

      vi.mocked(parseJwtPayload).mockReturnValueOnce(null);

      await useAuthStore
        .getState()
        .login('fallback@example.com', 'StrongP@ss1');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.email).toBe('fallback@example.com');
      expect(state.user?.roles).toEqual([]);
    });

    it('throws on API error', async () => {
      vi.mocked(api.postUnauthed).mockRejectedValueOnce(
        new ApiError(401, 'Invalid credentials'),
      );

      await expect(
        useAuthStore
          .getState()
          .login('bad@example.com', 'wrong'),
      ).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
    });
  });

  describe('register', () => {
    it('sets user with displayName on successful registration', async () => {
      const mockToken = createMockJwt({
        sub: 'user-789',
        email: 'new@example.com',
        roles: ['customer'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        user_id: 'user-789',
        access_token: mockToken,
        access_token_expires_at: new Date(
          Date.now() + 3600000,
        ).toISOString(),
      });

      vi.mocked(parseJwtPayload).mockReturnValueOnce({
        sub: 'user-789',
        email: 'new@example.com',
        roles: ['customer'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      await useAuthStore
        .getState()
        .register('new@example.com', 'StrongP@ss1', 'New User');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.displayName).toBe('New User');
      expect(state.user?.id).toBe('user-789');
      expect(setAccessToken).toHaveBeenCalledWith(mockToken);
    });

    it('handles registration when JWT parse fails', async () => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        user_id: 'user-abc',
        access_token: 'broken-token',
        access_token_expires_at: new Date(
          Date.now() + 3600000,
        ).toISOString(),
      });

      vi.mocked(parseJwtPayload).mockReturnValueOnce(null);

      await useAuthStore
        .getState()
        .register('reg@example.com', 'StrongP@ss1', 'Reg User');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.displayName).toBe('Reg User');
    });

    it('throws on API error during registration', async () => {
      vi.mocked(api.postUnauthed).mockRejectedValueOnce(
        new ApiError(409, 'Email already exists'),
      );

      await expect(
        useAuthStore
          .getState()
          .register('existing@example.com', 'StrongP@ss1', 'User'),
      ).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears state on logout', async () => {
      // Set up an authenticated state first
      useAuthStore.setState({
        user: {
          id: 'user-1',
          email: 'test@example.com',
          displayName: 'Test',
          avatarUrl: null,
          roles: ['customer'],
          status: 'active',
          emailVerified: true,
          phoneVerified: false,
          mfaEnabled: false,
          createdAt: new Date().toISOString(),
        },
        accessToken: 'some-token',
        isAuthenticated: true,
      });

      vi.mocked(api.post).mockResolvedValueOnce(undefined);

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(clearTokens).toHaveBeenCalled();
    });

    it('clears local state even if server logout fails with non-401', async () => {
      useAuthStore.setState({
        user: {
          id: 'user-1',
          email: 'test@example.com',
          displayName: 'Test',
          avatarUrl: null,
          roles: ['customer'],
          status: 'active',
          emailVerified: true,
          phoneVerified: false,
          mfaEnabled: false,
          createdAt: new Date().toISOString(),
        },
        accessToken: 'some-token',
        isAuthenticated: true,
      });

      vi.mocked(api.post).mockRejectedValueOnce(
        new Error('Network error'),
      );

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(clearTokens).toHaveBeenCalled();
    });

    it('clears local state when server returns 401 on logout', async () => {
      useAuthStore.setState({
        user: {
          id: 'user-1',
          email: 'test@example.com',
          displayName: 'Test',
          avatarUrl: null,
          roles: ['customer'],
          status: 'active',
          emailVerified: true,
          phoneVerified: false,
          mfaEnabled: false,
          createdAt: new Date().toISOString(),
        },
        accessToken: 'some-token',
        isAuthenticated: true,
      });

      vi.mocked(api.post).mockRejectedValueOnce(
        new ApiError(401, 'Unauthorized'),
      );

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('refreshToken', () => {
    it('returns true and updates token on successful refresh', async () => {
      const newToken = 'refreshed-token';

      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        access_token: newToken,
        refresh_token: 'new-refresh',
        access_token_expires_at: new Date(
          Date.now() + 3600000,
        ).toISOString(),
      });

      const result = await useAuthStore.getState().refreshToken();

      expect(result).toBe(true);
      expect(setAccessToken).toHaveBeenCalledWith(newToken);

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe(newToken);
      expect(state.isAuthenticated).toBe(true);
    });

    it('returns false and clears state on failed refresh', async () => {
      useAuthStore.setState({
        accessToken: 'old-token',
        isAuthenticated: true,
      });

      vi.mocked(api.postUnauthed).mockRejectedValueOnce(
        new Error('Refresh failed'),
      );

      const result = await useAuthStore.getState().refreshToken();

      expect(result).toBe(false);
      expect(clearTokens).toHaveBeenCalled();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('setUser', () => {
    it('updates the user', () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        roles: ['customer' as const],
        status: 'active' as const,
        emailVerified: true,
        phoneVerified: false,
        mfaEnabled: false,
        createdAt: '2026-01-01T00:00:00Z',
      };

      useAuthStore.getState().setUser(user);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
    });
  });

  describe('login (MFA branch)', () => {
    it('throws MFARequiredError when login response indicates MFA is required', async () => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        user_id: 'user-mfa-1',
        access_token: '',
        access_token_expires_at: new Date().toISOString(),
        mfa_required: true,
        mfa_challenge_token: 'mfa-challenge-token-abc',
      });

      let caught: unknown;
      try {
        await useAuthStore.getState().login('mfa@example.com', 'StrongP@ss1');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(MFARequiredError);
      const mfaErr = caught as MFARequiredError;
      expect(mfaErr.userId).toBe('user-mfa-1');
      expect(mfaErr.challengeToken).toBe('mfa-challenge-token-abc');
      expect(mfaErr.name).toBe('MFARequiredError');
      // Should NOT be authenticated when MFA is required
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(setAccessToken).not.toHaveBeenCalled();
    });

    it('throws if MFA is required but the challenge token is missing', async () => {
      const mockToken = createMockJwt({
        sub: 'user-x',
        email: 'x@example.com',
        roles: ['customer'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        user_id: 'user-x',
        access_token: mockToken,
        access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        mfa_required: true,
        mfa_challenge_token: null,
      });

      await expect(
        useAuthStore.getState().login('x@example.com', 'p'),
      ).rejects.toThrow(/MFA required but challenge missing/);

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(setAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('completeMFALogin', () => {
    it('verifies MFA and sets user from JWT payload', async () => {
      const mockToken = createMockJwt({
        sub: 'user-mfa-99',
        email: 'mfa@example.com',
        roles: ['provider'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        user_id: 'user-mfa-99',
        access_token: mockToken,
        access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      });

      vi.mocked(parseJwtPayload).mockReturnValueOnce({
        sub: 'user-mfa-99',
        email: 'mfa@example.com',
        roles: ['provider'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      await useAuthStore
        .getState()
        .completeMFALogin('challenge-token-1', '123456');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.accessToken).toBe(mockToken);
      expect(state.user?.id).toBe('user-mfa-99');
      expect(state.user?.email).toBe('mfa@example.com');
      expect(state.user?.roles).toEqual(['provider']);
      expect(setAccessToken).toHaveBeenCalledWith(mockToken);
      expect(api.postUnauthed).toHaveBeenCalledWith(
        '/api/v1/auth/mfa/verify',
        { mfa_challenge_token: 'challenge-token-1', totp_code: '123456' },
      );
    });

    it('falls back to JWT sub claim when response omits user_id', async () => {
      const mockToken = createMockJwt({
        sub: 'jwt-sub-user',
        email: 'sub@example.com',
        roles: ['customer'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        // No user_id in body
        access_token: mockToken,
        access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      });

      vi.mocked(parseJwtPayload).mockReturnValueOnce({
        sub: 'jwt-sub-user',
        email: 'sub@example.com',
        roles: ['customer'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      await useAuthStore
        .getState()
        .completeMFALogin('challenge-2', '654321');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.id).toBe('jwt-sub-user');
    });

    it('rejects the session when JWT payload cannot be parsed', async () => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        user_id: 'user-no-jwt',
        access_token: 'not-a-jwt',
        access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      });

      vi.mocked(parseJwtPayload).mockReturnValueOnce(null);

      await expect(
        useAuthStore.getState().completeMFALogin('challenge-3', '111111'),
      ).rejects.toThrow(/session could not be restored/);

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(setAccessToken).not.toHaveBeenCalled();
    });

    it('rejects the session when both response user_id and payload are missing', async () => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        // No user_id
        access_token: 'opaque',
        access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      });

      vi.mocked(parseJwtPayload).mockReturnValueOnce(null);

      await expect(
        useAuthStore.getState().completeMFALogin('challenge-empty', '222222'),
      ).rejects.toThrow(/session could not be restored/);

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(setAccessToken).not.toHaveBeenCalled();
    });

    it('throws and leaves state untouched on API error', async () => {
      vi.mocked(api.postUnauthed).mockRejectedValueOnce(
        new ApiError(401, 'Invalid TOTP code'),
      );

      await expect(
        useAuthStore.getState().completeMFALogin('challenge-bad', '000000'),
      ).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(setAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('refreshToken (JWT branches)', () => {
    it('reconstructs user from JWT payload when refresh succeeds', async () => {
      const newToken = createMockJwt({
        sub: 'refresh-user-1',
        email: 'refresh@example.com',
        roles: ['customer'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      vi.mocked(api.postUnauthed).mockResolvedValueOnce({
        access_token: newToken,
        refresh_token: 'rt',
        access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      });

      vi.mocked(parseJwtPayload).mockReturnValueOnce({
        sub: 'refresh-user-1',
        email: 'refresh@example.com',
        roles: ['customer'],
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      const ok = await useAuthStore.getState().refreshToken();

      expect(ok).toBe(true);
      const state = useAuthStore.getState();
      expect(state.user?.id).toBe('refresh-user-1');
      expect(state.user?.email).toBe('refresh@example.com');
      expect(state.user?.roles).toEqual(['customer']);
      expect(state.isHydrating).toBe(false);
    });

    it('clears isHydrating after a failed refresh', async () => {
      useAuthStore.setState({ isHydrating: true });
      vi.mocked(api.postUnauthed).mockRejectedValueOnce(new Error('boom'));

      const ok = await useAuthStore.getState().refreshToken();

      expect(ok).toBe(false);
      expect(useAuthStore.getState().isHydrating).toBe(false);
    });
  });

  describe('MFARequiredError', () => {
    it('exposes userId and challengeToken with default message', () => {
      const err = new MFARequiredError('uid', 'ctok');
      expect(err.userId).toBe('uid');
      expect(err.challengeToken).toBe('ctok');
      expect(err.message).toBe('MFA verification required');
      expect(err.name).toBe('MFARequiredError');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('reset', () => {
    it('resets to initial state', () => {
      useAuthStore.setState({
        user: {
          id: 'user-1',
          email: 'test@example.com',
          displayName: 'Test',
          avatarUrl: null,
          roles: ['customer'],
          status: 'active',
          emailVerified: true,
          phoneVerified: false,
          mfaEnabled: false,
          createdAt: new Date().toISOString(),
        },
        accessToken: 'some-token',
        isAuthenticated: true,
      });

      useAuthStore.getState().reset();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(clearTokens).toHaveBeenCalled();
    });
  });
});
