import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyAccessToken, verifyJwt } from '@/lib/server/verify-jwt';

// ── Test key material ─────────────────────────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const ISSUER = 'https://auth.nomarkup.com';
const AUDIENCE = 'nomarkup-api';

const NOW_MS = 1_750_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

interface SignOptions {
  header?: Record<string, unknown>;
  key?: KeyObject;
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Build a compact RS256 JWS (default header) over arbitrary claims. */
function signToken(payload: Record<string, unknown>, opts: SignOptions = {}): string {
  const header = opts.header ?? { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature = cryptoSign(
    'RSA-SHA256',
    Buffer.from(signingInput, 'utf8'),
    opts.key ?? privateKey,
  ).toString('base64url');
  return `${signingInput}.${signature}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: [AUDIENCE],
    sub: 'user-123',
    iat: NOW_S,
    exp: NOW_S + 900, // 15 min, matches the user service
    email: 'a@b.com',
    roles: ['customer'],
    ...overrides,
  };
}

const OPTS = { issuer: ISSUER, audience: AUDIENCE, nowMs: NOW_MS };

describe('verifyJwt', () => {
  it('accepts a valid token and returns its claims', () => {
    const token = signToken(validClaims());
    const result = verifyJwt(token, publicKey, OPTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe('user-123');
      expect(result.claims.email).toBe('a@b.com');
      expect(result.claims.roles).toEqual(['customer']);
    }
  });

  it('accepts a string (non-array) aud claim', () => {
    const token = signToken(validClaims({ aud: AUDIENCE }));
    expect(verifyJwt(token, publicKey, OPTS).ok).toBe(true);
  });

  it('rejects an expired token', () => {
    const token = signToken(validClaims({ exp: NOW_S - 1 }));
    const result = verifyJwt(token, publicKey, OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token expired');
  });

  it('rejects a token with a missing exp claim', () => {
    const claims = validClaims();
    delete claims['exp'];
    const token = signToken(claims);
    expect(verifyJwt(token, publicKey, OPTS).ok).toBe(false);
  });

  it('rejects a token signed by a different key', () => {
    const token = signToken(validClaims(), { key: otherPrivateKey });
    const result = verifyJwt(token, publicKey, OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid signature');
  });

  it('rejects a token whose payload was tampered with after signing', () => {
    const token = signToken(validClaims());
    const [headerB64 = '', , signatureB64 = ''] = token.split('.');
    const tampered = `${headerB64}.${b64url(validClaims({ sub: 'attacker' }))}.${signatureB64}`;
    expect(verifyJwt(tampered, publicKey, OPTS).ok).toBe(false);
  });

  it('rejects a wrong issuer', () => {
    const token = signToken(validClaims({ iss: 'https://evil.example.com' }));
    const result = verifyJwt(token, publicKey, OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('issuer mismatch');
  });

  it('rejects a wrong audience', () => {
    const token = signToken(validClaims({ aud: ['some-other-api'] }));
    const result = verifyJwt(token, publicKey, OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('audience mismatch');
  });

  it('rejects alg=none (unsigned) tokens', () => {
    const header = { alg: 'none', typ: 'JWT' };
    const token = `${b64url(header)}.${b64url(validClaims())}.`;
    expect(verifyJwt(token, publicKey, OPTS).ok).toBe(false);
  });

  it('rejects non-RS256 algorithms even with a valid-looking signature', () => {
    const token = signToken(validClaims(), { header: { alg: 'HS256', typ: 'JWT' } });
    const result = verifyJwt(token, publicKey, OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unexpected signing algorithm');
  });

  it('rejects a token missing the sub claim', () => {
    const claims = validClaims();
    delete claims['sub'];
    const token = signToken(claims);
    expect(verifyJwt(token, publicKey, OPTS).ok).toBe(false);
  });

  it('rejects a not-yet-valid token (nbf in the future)', () => {
    const token = signToken(validClaims({ nbf: NOW_S + 600 }));
    expect(verifyJwt(token, publicKey, OPTS).ok).toBe(false);
  });

  it.each(['', 'not-a-jwt', 'a.b', 'a.b.c.d', '!!!.@@@.###'])(
    'rejects malformed token %j',
    (bad) => {
      expect(verifyJwt(bad, publicKey, OPTS).ok).toBe(false);
    },
  );
});

describe('verifyAccessToken (env-configured public key)', () => {
  const originalPath = process.env['JWT_PUBLIC_KEY_PATH'];

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env['JWT_PUBLIC_KEY_PATH'];
    } else {
      process.env['JWT_PUBLIC_KEY_PATH'] = originalPath;
    }
  });

  it('verifies a token using the key file at JWT_PUBLIC_KEY_PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nomarkup-jwt-'));
    const pemPath = join(dir, 'public.pem');
    writeFileSync(pemPath, publicKey.export({ type: 'spki', format: 'pem' }));
    process.env['JWT_PUBLIC_KEY_PATH'] = pemPath;

    // Use a real future exp since verifyAccessToken uses the real clock.
    const nowS = Math.floor(Date.now() / 1000);
    const token = signToken(validClaims({ iat: nowS, exp: nowS + 900 }));
    const result = verifyAccessToken(token);
    expect(result.ok).toBe(true);

    // Cached key path: a second verification must also succeed.
    expect(verifyAccessToken(token).ok).toBe(true);
  });

  it('fails closed when JWT_PUBLIC_KEY_PATH is unset', () => {
    delete process.env['JWT_PUBLIC_KEY_PATH'];
    const token = signToken(validClaims());
    const result = verifyAccessToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('JWT public key not configured');
  });

  it('fails closed when the key file does not exist', () => {
    process.env['JWT_PUBLIC_KEY_PATH'] = '/nonexistent/never/public.pem';
    const result = verifyAccessToken(signToken(validClaims()));
    expect(result.ok).toBe(false);
  });
});
