// auth-store — a session is adopted only when the user id is known. The guard
// used to compare with '' only, so a decodable token with no `sub` claim and
// an empty user_id in the response signed in with user.id === undefined.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth-store';

const h = vi.hoisted(() => ({
  setAccessToken: vi.fn<(token: string) => void>(),
  clearTokens: vi.fn<() => void>(),
  postUnauthed: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn(), postUnauthed: h.postUnauthed },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, setAccessToken: h.setAccessToken, clearTokens: h.clearTokens };
});

vi.mock('@/lib/query-client', () => ({ queryClient: { clear: vi.fn() } }));

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value));
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const EXPIRES = '2026-03-01T12:15:00Z';
const CLAIMS = { email: 'pat@example.com', roles: ['provider'], exp: 1, iat: 0 };
const WITH_SUB = jwt({ ...CLAIMS, sub: 'sub-1' });
const NO_SUB = jwt(CLAIMS);
const NULL_SUB = jwt({ ...CLAIMS, sub: null });
const EMPTY_SUB = jwt({ ...CLAIMS, sub: '' });

function expectSignedOut() {
  const state = useAuthStore.getState();
  expect(state.isAuthenticated).toBe(false);
  expect(state.user).toBeNull();
  expect(state.accessToken).toBeNull();
  expect(h.setAccessToken).not.toHaveBeenCalled();
}

beforeEach(() => {
  useAuthStore.getState().reset();
  vi.clearAllMocks();
});

describe('adoptSession — which token shapes sign in', () => {
  it.each([
    ['response user_id and token sub', 'u-1', WITH_SUB, 'u-1'],
    ['empty response user_id, token sub', '', WITH_SUB, 'sub-1'],
    ['response user_id, token without sub', 'u-1', NO_SUB, 'u-1'],
  ])('accepts %s', (_label, userId, token, expectedId) => {
    useAuthStore.getState().adoptSession({
      user_id: userId,
      access_token: token,
      access_token_expires_at: EXPIRES,
    });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toMatchObject({ id: expectedId, email: 'pat@example.com', roles: ['provider'] });
    expect(state.accessToken).toBe(token);
    expect(h.setAccessToken).toHaveBeenCalledWith(token);
    expect(h.clearTokens).not.toHaveBeenCalled();
  });

  it.each([
    ['a token with no sub claim', NO_SUB],
    ['a token whose sub is null', NULL_SUB],
    ['a token whose sub is empty', EMPTY_SUB],
    ['a token that cannot be decoded', 'not-a-jwt'],
  ])('refuses %s when the response has no user_id', (_label, token) => {
    expect(() => {
      useAuthStore.getState().adoptSession({
        user_id: '',
        access_token: token,
        access_token_expires_at: EXPIRES,
      });
    }).toThrow('Sign-in succeeded but the session could not be restored. Please try again.');

    expect(h.clearTokens).toHaveBeenCalledTimes(1);
    expectSignedOut();
  });
});

describe('completeMFALogin — which token shapes sign in', () => {
  it('accepts a token with a sub when the response omits user_id', async () => {
    h.postUnauthed.mockResolvedValue({ access_token: WITH_SUB, access_token_expires_at: EXPIRES });

    await useAuthStore.getState().completeMFALogin('challenge', '123456');

    expect(useAuthStore.getState().user).toMatchObject({ id: 'sub-1' });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it.each([
    ['no sub claim', NO_SUB],
    ['a null sub', NULL_SUB],
    ['an empty sub', EMPTY_SUB],
  ])('refuses a token with %s when the response omits user_id', async (_label, token) => {
    h.postUnauthed.mockResolvedValue({ access_token: token, access_token_expires_at: EXPIRES });

    await expect(useAuthStore.getState().completeMFALogin('challenge', '123456')).rejects.toThrow(
      'Login succeeded but the session could not be restored. Please try again.',
    );

    expect(h.clearTokens).toHaveBeenCalledTimes(1);
    expectSignedOut();
  });
});

describe('refreshToken — identity from the refreshed token', () => {
  it('restores the user from a token with a sub', async () => {
    h.postUnauthed.mockResolvedValue({ access_token: WITH_SUB, access_token_expires_at: EXPIRES });

    await expect(useAuthStore.getState().refreshToken()).resolves.toBe(true);

    expect(useAuthStore.getState().user).toMatchObject({ id: 'sub-1', roles: ['provider'] });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('keeps the session but sets no user when the token has no sub', async () => {
    h.postUnauthed.mockResolvedValue({ access_token: NO_SUB, access_token_expires_at: EXPIRES });

    await expect(useAuthStore.getState().refreshToken()).resolves.toBe(true);

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
