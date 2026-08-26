import { create } from 'zustand';

import { api, ApiError } from '@/lib/api';
import { clearTokens, parseJwtPayload, setAccessToken } from '@/lib/auth';
import { queryClient } from '@/lib/query-client';
import type {
  AuthResponse,
  LoginInput,
  LoginResponse,
  RegisterInput,
  TokenPair,
  User,
  UserRole,
} from '@/types';

/** Thrown when login succeeds but MFA verification is required. */
export class MFARequiredError extends Error {
  constructor(
    public readonly userId: string,
    public readonly challengeToken: string,
  ) {
    super('MFA verification required');
    this.name = 'MFARequiredError';
  }
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  /** True until the first auth check (refreshToken) completes (success or failure). */
  isHydrating: boolean;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  completeMFALogin: (challengeToken: string, totpCode: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  setUser: (user: User) => void;
  reset: () => void;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isHydrating: true,
};

function userFromJwt(
  userId: string,
  payload: { email: string; roles: string[] },
): User {
  return {
    id: userId,
    email: payload.email,
    displayName: '',
    avatarUrl: null,
    roles: payload.roles as UserRole[],
    status: 'active',
    emailVerified: false,
    phoneVerified: false,
    mfaEnabled: false,
    createdAt: new Date().toISOString(),
  };
}

export const useAuthStore = create<AuthState & AuthActions>()((set) => ({
  ...initialState,

  login: async (email: string, password: string) => {
    const body: LoginInput = { email, password };
    const data = await api.postUnauthed<LoginResponse>(
      '/api/v1/auth/login',
      body,
    );

    if (data.mfa_required) {
      if (!data.mfa_challenge_token) {
        throw new Error('MFA required but challenge missing');
      }
      throw new MFARequiredError(data.user_id, data.mfa_challenge_token);
    }

    setAccessToken(data.access_token);

    const payload = parseJwtPayload(data.access_token);
    const user = payload
      ? userFromJwt(data.user_id, payload)
      : userFromJwt(data.user_id, { email, roles: [] });

    set({
      user,
      accessToken: data.access_token,
      isAuthenticated: true,
      isHydrating: false,
    });
  },

  completeMFALogin: async (challengeToken: string, totpCode: string) => {
    const data = await api.postUnauthed<AuthResponse>(
      '/api/v1/auth/mfa/verify',
      {
        mfa_challenge_token: challengeToken,
        totp_code: totpCode,
      },
    );

    const payload = parseJwtPayload(data.access_token);
    // The MFA verify endpoint may not return user_id in the body,
    // so we extract it from the JWT payload (sub claim).
    const userId = data.user_id || (payload ? payload.sub : '');
    if (!payload || userId === '') {
      clearTokens();
      throw new Error('Login succeeded but the session could not be restored. Please try again.');
    }

    setAccessToken(data.access_token);
    set({
      user: userFromJwt(userId, payload),
      accessToken: data.access_token,
      isAuthenticated: true,
      isHydrating: false,
    });
  },

  register: async (
    email: string,
    password: string,
    displayName: string,
  ) => {
    const body: RegisterInput = {
      email,
      password,
      display_name: displayName,
    };
    const data = await api.postUnauthed<AuthResponse>(
      '/api/v1/auth/register',
      body,
    );

    setAccessToken(data.access_token);

    const payload = parseJwtPayload(data.access_token);
    const user = payload
      ? { ...userFromJwt(data.user_id, payload), displayName }
      : userFromJwt(data.user_id, { email, roles: [] });
    user.displayName = displayName;

    set({
      user,
      accessToken: data.access_token,
      isAuthenticated: true,
      isHydrating: false,
    });
  },

  logout: async () => {
    try {
      await api.post('/api/v1/auth/logout');
    } catch (error) {
      // If logout fails on server, still clear local state
      if (!(error instanceof ApiError && error.status === 401)) {
        // Log unexpected errors but still proceed with local cleanup
      }
    }
    clearTokens();
    // Drop all cached per-user server state so the next account that logs in
    // in this tab doesn't inherit the previous user's notifications, etc.
    // (Root cause of the notification mark-read 404: stale notification ids
    // from a prior user were sent under the new user's token.)
    queryClient.clear();
    set({ ...initialState, isHydrating: false });
  },

  refreshToken: async () => {
    try {
      const data = await api.postUnauthed<TokenPair>(
        '/api/v1/auth/refresh',
      );
      setAccessToken(data.access_token);

      // Parse the JWT to reconstruct the user object so that role
      // checks (e.g. isProvider) work on public pages where
      // AuthRestorer hydrates the store asynchronously.
      const payload = parseJwtPayload(data.access_token);
      const user = payload
        ? userFromJwt(payload.sub, payload)
        : null;

      set({
        user,
        accessToken: data.access_token,
        isAuthenticated: true,
        isHydrating: false,
      });
      return true;
    } catch {
      clearTokens();
      set({ ...initialState, isHydrating: false });
      return false;
    }
  },

  setUser: (user: User) => {
    set({ user });
  },

  reset: () => {
    clearTokens();
    set({ ...initialState, isHydrating: false });
  },
}));
