import { create } from 'zustand';

import { api, ApiError } from '@/lib/api';
import { clearTokens, parseJwtPayload, setAccessToken } from '@/lib/auth';
import type {
  AuthResponse,
  LoginInput,
  LoginResponse,
  RegisterInput,
  TokenPair,
  User,
  UserRole,
} from '@/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
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

    setAccessToken(data.access_token);

    const payload = parseJwtPayload(data.access_token);
    const user = payload
      ? userFromJwt(data.user_id, payload)
      : userFromJwt(data.user_id, { email, roles: [] });

    set({
      user,
      accessToken: data.access_token,
      isAuthenticated: true,
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
    set(initialState);
  },

  refreshToken: async () => {
    try {
      const data = await api.postUnauthed<TokenPair>(
        '/api/v1/auth/refresh',
      );
      setAccessToken(data.access_token);
      set({ accessToken: data.access_token, isAuthenticated: true });
      return true;
    } catch {
      clearTokens();
      set(initialState);
      return false;
    }
  },

  setUser: (user: User) => {
    set({ user });
  },

  reset: () => {
    clearTokens();
    set(initialState);
  },
}));
