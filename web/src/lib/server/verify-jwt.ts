/**
 * Server-only RS256 JWT verification for Next.js API routes.
 *
 * Mirrors the validation the Go user service / gateway performs
 * (`services/user/internal/service/jwt.go`): signature (RS256 only), `exp`,
 * `iss`, and `aud` must all check out. Tokens are issued by the user service
 * with iss=JWT_ISSUER (default https://auth.nomarkup.com) and
 * aud=JWT_AUDIENCE (default nomarkup-api).
 *
 * Uses only Node's built-in `crypto` — no new dependencies. The public key is
 * loaded from the file at JWT_PUBLIC_KEY_PATH (same env var the gateway uses;
 * web/.env.local is a symlink to the root .env.local, so it is already
 * available to the Next server) and cached across invocations.
 *
 * NOT importable from client components — Node builtins keep it server-only.
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Defaults must match services/user/internal/service/jwt.go and the gateway.
const DEFAULT_JWT_ISSUER = 'https://auth.nomarkup.com';
const DEFAULT_JWT_AUDIENCE = 'nomarkup-api';

export interface VerifiedClaims {
  /** User ID (UUID) — the token subject. */
  sub: string;
  /** Unix seconds expiry. */
  exp: number;
  iss: string;
  aud: string | string[];
  email?: string;
  roles?: string[];
}

export type VerifyJwtResult =
  | { ok: true; claims: VerifiedClaims }
  | { ok: false; reason: string };

export interface VerifyJwtOptions {
  issuer?: string;
  audience?: string;
  /** Injectable clock for tests; defaults to Date.now(). */
  nowMs?: number;
}

function expectedIssuer(): string {
  const v = process.env['JWT_ISSUER']?.trim();
  return v !== undefined && v !== '' ? v : DEFAULT_JWT_ISSUER;
}

function expectedAudience(): string {
  const v = process.env['JWT_AUDIENCE']?.trim();
  return v !== undefined && v !== '' ? v : DEFAULT_JWT_AUDIENCE;
}

function decodeBase64UrlJson(segment: string): unknown {
  const decoded = Buffer.from(segment, 'base64url');
  // Buffer.from(base64url) silently drops invalid characters; round-trip to
  // catch garbage segments instead of parsing a truncated decode.
  if (decoded.toString('base64url') !== segment.replace(/=+$/, '')) {
    throw new Error('invalid base64url');
  }
  return JSON.parse(decoded.toString('utf8')) as unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function audienceMatches(aud: unknown, expected: string): aud is string | string[] {
  if (typeof aud === 'string') return aud === expected;
  if (Array.isArray(aud)) {
    return aud.some((a) => typeof a === 'string' && a === expected);
  }
  return false;
}

/**
 * Verify a compact RS256 JWS against the given RSA public key.
 * Pure function — key and clock are injectable for tests.
 */
export function verifyJwt(
  token: string,
  publicKey: KeyObject,
  options: VerifyJwtOptions = {},
): VerifyJwtResult {
  const nowMs = options.nowMs ?? Date.now();
  const issuer = options.issuer ?? expectedIssuer();
  const audience = options.audience ?? expectedAudience();

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  if (!headerB64 || !payloadB64 || !signatureB64) {
    return { ok: false, reason: 'malformed token' };
  }

  // ── Header: pin the algorithm to RS256 (rejects "none", HS256, etc.) ──
  let header: unknown;
  try {
    header = decodeBase64UrlJson(headerB64);
  } catch {
    return { ok: false, reason: 'malformed header' };
  }
  if (!isRecord(header) || header['alg'] !== 'RS256') {
    return { ok: false, reason: 'unexpected signing algorithm' };
  }

  // ── Signature ──
  let signatureValid: boolean;
  try {
    signatureValid = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'),
      publicKey,
      Buffer.from(signatureB64, 'base64url'),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, reason: 'invalid signature' };

  // ── Claims ──
  let payload: unknown;
  try {
    payload = decodeBase64UrlJson(payloadB64);
  } catch {
    return { ok: false, reason: 'malformed payload' };
  }
  if (!isRecord(payload)) return { ok: false, reason: 'malformed payload' };

  const exp = payload['exp'];
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return { ok: false, reason: 'missing exp' };
  }
  if (nowMs >= exp * 1000) return { ok: false, reason: 'token expired' };

  const nbf = payload['nbf'];
  if (typeof nbf === 'number' && nowMs < nbf * 1000) {
    return { ok: false, reason: 'token not yet valid' };
  }

  const iss = payload['iss'];
  if (iss !== issuer) return { ok: false, reason: 'issuer mismatch' };

  const aud = payload['aud'];
  if (!audienceMatches(aud, audience)) {
    return { ok: false, reason: 'audience mismatch' };
  }

  const sub = payload['sub'];
  if (typeof sub !== 'string' || sub === '') {
    return { ok: false, reason: 'missing sub' };
  }

  const email = payload['email'];
  const roles = payload['roles'];
  const claims: VerifiedClaims = {
    sub,
    exp,
    iss,
    aud,
    ...(typeof email === 'string' ? { email } : {}),
    ...(Array.isArray(roles) && roles.every((r): r is string => typeof r === 'string')
      ? { roles }
      : {}),
  };
  return { ok: true, claims };
}

// ── Public-key loading (cached across invocations) ─────────────────────

let cachedKey: { path: string; key: KeyObject } | null = null;

/**
 * Load (and cache) the RSA public key from JWT_PUBLIC_KEY_PATH.
 * Returns null when the env var is unset or the file is unreadable —
 * callers must treat that as "cannot verify" and fail closed.
 */
export function loadJwtPublicKey(): KeyObject | null {
  const path = process.env['JWT_PUBLIC_KEY_PATH'];
  if (!path) return null;
  if (cachedKey && cachedKey.path === path) return cachedKey.key;
  try {
    const pem = readFileSync(path, 'utf8');
    const key = createPublicKey(pem);
    cachedKey = { path, key };
    return key;
  } catch {
    return null;
  }
}

/**
 * Verify a platform access token using the configured public key.
 * Fails closed (returns ok:false) when the key is not configured.
 */
export function verifyAccessToken(token: string): VerifyJwtResult {
  const key = loadJwtPublicKey();
  if (!key) return { ok: false, reason: 'JWT public key not configured' };
  return verifyJwt(token, key);
}
