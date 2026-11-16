// verify-jwt — issuer / audience taken from the environment (and the
// defaults when blank), audience shapes, a payload that is not an object,
// and optional claims of the wrong type being dropped.
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyJwt } from '@/lib/server/verify-jwt';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const DEFAULT_ISSUER = 'https://auth.no-markup.com';
const DEFAULT_AUDIENCE = 'nomarkup-api';
const NOW_MS = 1_750_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Sign any JSON value as the payload of an RS256 token. */
function sign(payload: unknown): string {
  const signingInput = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), privateKey).toString(
    'base64url',
  );
  return `${signingInput}.${signature}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: DEFAULT_ISSUER,
    aud: DEFAULT_AUDIENCE,
    sub: 'user-123',
    exp: NOW_S + 900,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifyJwt — issuer and audience from the environment', () => {
  it('uses the built-in issuer and audience when the variables are unset', () => {
    vi.stubEnv('JWT_ISSUER', undefined);
    vi.stubEnv('JWT_AUDIENCE', undefined);

    expect(verifyJwt(sign(claims()), publicKey, { nowMs: NOW_MS })).toMatchObject({ ok: true });
  });

  it('treats blank variables as unset', () => {
    vi.stubEnv('JWT_ISSUER', '   ');
    vi.stubEnv('JWT_AUDIENCE', '');

    expect(verifyJwt(sign(claims()), publicKey, { nowMs: NOW_MS })).toMatchObject({ ok: true });
  });

  it('requires the configured issuer (trimmed) and rejects the default one', () => {
    vi.stubEnv('JWT_ISSUER', ' https://auth.staging.test ');

    expect(verifyJwt(sign(claims()), publicKey, { nowMs: NOW_MS })).toEqual({
      ok: false,
      reason: 'issuer mismatch',
    });
    expect(
      verifyJwt(sign(claims({ iss: 'https://auth.staging.test' })), publicKey, { nowMs: NOW_MS }),
    ).toMatchObject({ ok: true });
  });

  it('requires the configured audience and rejects the default one', () => {
    vi.stubEnv('JWT_AUDIENCE', 'staging-api');

    expect(verifyJwt(sign(claims()), publicKey, { nowMs: NOW_MS })).toEqual({
      ok: false,
      reason: 'audience mismatch',
    });
    expect(
      verifyJwt(sign(claims({ aud: ['other', 'staging-api'] })), publicKey, { nowMs: NOW_MS }),
    ).toMatchObject({ ok: true });
  });

  it('explicit options win over the environment', () => {
    vi.stubEnv('JWT_ISSUER', 'https://auth.staging.test');
    vi.stubEnv('JWT_AUDIENCE', 'staging-api');

    expect(
      verifyJwt(sign(claims()), publicKey, {
        nowMs: NOW_MS,
        issuer: DEFAULT_ISSUER,
        audience: DEFAULT_AUDIENCE,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe('verifyJwt — audience shapes', () => {
  const opts = { nowMs: NOW_MS, issuer: DEFAULT_ISSUER, audience: DEFAULT_AUDIENCE };

  it.each([
    ['a number', 42],
    ['an object', { [DEFAULT_AUDIENCE]: true }],
    ['null', null],
    ['an array without the audience', ['other-api']],
    ['an array holding a non-string that stringifies to the audience', [[DEFAULT_AUDIENCE]]],
    ['a string that merely contains the audience', `${DEFAULT_AUDIENCE}-admin`],
  ])('rejects %s', (_name, aud) => {
    expect(verifyJwt(sign(claims({ aud })), publicKey, opts)).toEqual({
      ok: false,
      reason: 'audience mismatch',
    });
  });

  it('rejects a token with no aud claim', () => {
    const { aud: _aud, ...withoutAud } = claims();
    expect(verifyJwt(sign(withoutAud), publicKey, opts)).toEqual({
      ok: false,
      reason: 'audience mismatch',
    });
  });

  it('returns the aud claim exactly as signed (string stays a string)', () => {
    const result = verifyJwt(sign(claims()), publicKey, opts);
    expect(result).toEqual({
      ok: true,
      claims: { sub: 'user-123', exp: NOW_S + 900, iss: DEFAULT_ISSUER, aud: DEFAULT_AUDIENCE },
    });
  });
});

describe('verifyJwt — payload shape and optional claims', () => {
  const opts = { nowMs: NOW_MS, issuer: DEFAULT_ISSUER, audience: DEFAULT_AUDIENCE };

  it.each([
    ['an array', [claims()]],
    ['a string', 'user-123'],
    ['null', null],
  ])('rejects a validly signed payload that is %s', (_name, payload) => {
    expect(verifyJwt(sign(payload), publicKey, opts)).toEqual({
      ok: false,
      reason: 'malformed payload',
    });
  });

  it('drops an email that is not a string and roles that are not all strings', () => {
    const result = verifyJwt(
      sign(claims({ email: { address: 'a@b.com' }, roles: ['customer', 7] })),
      publicKey,
      opts,
    );
    expect(result).toEqual({
      ok: true,
      claims: { sub: 'user-123', exp: NOW_S + 900, iss: DEFAULT_ISSUER, aud: DEFAULT_AUDIENCE },
    });
  });

  it('drops roles that are a string rather than an array, keeps a valid email', () => {
    const result = verifyJwt(sign(claims({ email: 'a@b.com', roles: 'admin' })), publicKey, opts);
    expect(result).toEqual({
      ok: true,
      claims: {
        sub: 'user-123',
        exp: NOW_S + 900,
        iss: DEFAULT_ISSUER,
        aud: DEFAULT_AUDIENCE,
        email: 'a@b.com',
      },
    });
  });

  it('keeps an empty roles array', () => {
    const result = verifyJwt(sign(claims({ roles: [] })), publicKey, opts);
    expect(result).toMatchObject({ ok: true, claims: { roles: [] } });
  });

  it.each([
    ['a string exp', { exp: String(NOW_S + 900) }, 'missing exp'],
    ['exp exactly now', { exp: NOW_S }, 'token expired'],
    ['nbf in the future', { nbf: NOW_S + 60 }, 'token not yet valid'],
    ['an empty sub', { sub: '' }, 'missing sub'],
    ['a numeric sub', { sub: 123 }, 'missing sub'],
  ])('rejects %s', (_name, overrides, reason) => {
    expect(verifyJwt(sign(claims(overrides)), publicKey, opts)).toEqual({ ok: false, reason });
  });

  it('ignores an nbf that is not a number', () => {
    expect(verifyJwt(sign(claims({ nbf: 'tomorrow' })), publicKey, opts)).toMatchObject({ ok: true });
  });
});
