import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth-store';

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
