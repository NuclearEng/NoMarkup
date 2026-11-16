// auth-store — adoptSession: which user id wins, and the refusal paths when
// the access token cannot be decoded. Uses the real JWT payload decoder; only
// token storage is stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth-store';

const tokens = vi.hoisted(() => ({
  setAccessToken: vi.fn<(token: string) => void>(),
  clearTokens: vi.fn<() => void>(),
}));

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn(), postUnauthed: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, setAccessToken: tokens.setAccessToken, clearTokens: tokens.clearTokens };
});

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value));
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const EXPIRES = '2026-03-01T12:15:00Z';
const PAYLOAD = { sub: 'sub-from-token', email: 'pat@example.com', roles: ['provider'], exp: 1, iat: 0 };

beforeEach(() => {
  useAuthStore.getState().reset();
  vi.clearAllMocks();
});

describe('adoptSession', () => {
  it('uses the response user_id over the token subject', () => {
    const token = jwt(PAYLOAD);

    useAuthStore.getState().adoptSession({
      user_id: 'id-from-response',
      access_token: token,
      access_token_expires_at: EXPIRES,
    });

    const state = useAuthStore.getState();
    expect(state.user).toMatchObject({
      id: 'id-from-response',
      email: 'pat@example.com',
      roles: ['provider'],
    });
    expect(state.accessToken).toBe(token);
    expect(state.isAuthenticated).toBe(true);
    expect(state.isHydrating).toBe(false);
    expect(tokens.setAccessToken).toHaveBeenCalledWith(token);
    expect(tokens.clearTokens).not.toHaveBeenCalled();
  });

  it('falls back to the token subject when the response has no user_id', () => {
    useAuthStore.getState().adoptSession({
      user_id: '',
      access_token: jwt(PAYLOAD),
      access_token_expires_at: EXPIRES,
    });

    expect(useAuthStore.getState().user?.id).toBe('sub-from-token');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it.each([
    ['a token with no payload segment', 'not-a-jwt'],
    ['a payload that is not base64 JSON', 'header.%%%.signature'],
  ])('refuses %s even with a user_id: tokens cleared, store left signed out', (_name, token) => {
    expect(() => {
      useAuthStore.getState().adoptSession({
        user_id: 'id-from-response',
        access_token: token,
        access_token_expires_at: EXPIRES,
      });
    }).toThrow('Sign-in succeeded but the session could not be restored. Please try again.');

    expect(tokens.clearTokens).toHaveBeenCalledTimes(1);
    expect(tokens.setAccessToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });

  it('refuses a decodable token when neither the response nor the token names a user', () => {
    expect(() => {
      useAuthStore.getState().adoptSession({
        user_id: '',
        access_token: jwt({ ...PAYLOAD, sub: '' }),
        access_token_expires_at: EXPIRES,
      });
    }).toThrow('Sign-in succeeded but the session could not be restored. Please try again.');

    expect(tokens.clearTokens).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  // Source bug (auth-store.ts:215-216): the guard is `userId === ''`, but a
  // decodable token with no `sub` claim at all yields `undefined`, which
  // passes the guard and signs the user in with `user.id === undefined`.
  it.todo('refuses a token whose payload has no sub claim when the response has no user_id');

  it('replaces a previously adopted session', () => {
    const store = useAuthStore.getState();
    store.adoptSession({ user_id: 'u-1', access_token: jwt(PAYLOAD), access_token_expires_at: EXPIRES });
    const second = jwt({ ...PAYLOAD, email: 'sam@example.com', roles: ['customer'] });

    store.adoptSession({ user_id: 'u-2', access_token: second, access_token_expires_at: EXPIRES });

    expect(useAuthStore.getState().user).toMatchObject({
      id: 'u-2',
      email: 'sam@example.com',
      roles: ['customer'],
    });
    expect(useAuthStore.getState().accessToken).toBe(second);
  });
});
