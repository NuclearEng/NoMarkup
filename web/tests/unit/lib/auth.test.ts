import { afterEach, describe, expect, it } from 'vitest';

import {
  clearTokens,
  getAccessToken,
  isAuthenticated,
  parseJwtPayload,
  setAccessToken,
} from '@/lib/auth';

describe('access-token storage', () => {
  afterEach(() => {
    clearTokens();
  });

  it('starts unauthenticated', () => {
    expect(getAccessToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it('setAccessToken persists in-memory', () => {
    setAccessToken('jwt-1');
    expect(getAccessToken()).toBe('jwt-1');
    expect(isAuthenticated()).toBe(true);
  });

  it('setAccessToken(null) is equivalent to clearTokens', () => {
    setAccessToken('jwt-1');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it('clearTokens wipes the in-memory token', () => {
    setAccessToken('jwt-1');
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });
});

describe('parseJwtPayload', () => {
  it('decodes a valid HS256 JWT payload', () => {
    // Hand-crafted JWT (no signature verification — auth.ts says so).
    // Header: {"alg":"HS256","typ":"JWT"}
    // Payload: {"sub":"user-1","email":"a@b.c","roles":["customer"],"exp":9999999999,"iat":1700000000}
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const payload = btoa(
      JSON.stringify({
        sub: 'user-1',
        email: 'a@b.c',
        roles: ['customer', 'provider'],
        exp: 9999999999,
        iat: 1700000000,
      }),
    )
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const token = `${header}.${payload}.fake-signature`;

    const decoded = parseJwtPayload(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.sub).toBe('user-1');
    expect(decoded?.email).toBe('a@b.c');
    expect(decoded?.roles).toEqual(['customer', 'provider']);
    expect(decoded?.exp).toBe(9999999999);
  });

  it('handles base64url URL-safe characters (- and _)', () => {
    // Force the encoded payload to include - and _ by choosing email/sub that
    // produce '+' or '/' under standard base64.
    const payload = btoa(
      JSON.stringify({ sub: '???', email: '<>?', roles: [], exp: 0, iat: 0 }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const token = `header.${payload}.sig`;
    const decoded = parseJwtPayload(token);
    expect(decoded?.sub).toBe('???');
  });

  it('returns null on a token missing the payload segment', () => {
    expect(parseJwtPayload('only-one-part')).toBeNull();
  });

  it('returns null on a token with non-JSON payload', () => {
    const garbage = btoa('not-json-at-all').replace(/=/g, '');
    const token = `header.${garbage}.sig`;
    expect(parseJwtPayload(token)).toBeNull();
  });

  it('returns null on a token with malformed base64 payload', () => {
    expect(parseJwtPayload('header.@@@invalid@@@.sig')).toBeNull();
  });
});
