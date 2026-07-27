/**
 * SEC-07: HMAC-signed `has_session` soft-gate cookie.
 *
 * The gateway (Go) mints this cookie on login/refresh/OAuth using SESSION_SECRET
 * (or HAS_SESSION_SECRET). Next.js edge middleware verifies the signature and
 * exp before treating the request as "soft logged in" for protected-route
 * redirects. It is NEVER used as data authorization — the RS256 access JWT
 * (and HttpOnly refresh_token) remain the real credentials.
 *
 * Wire format (must match gateway/internal/sessionflag):
 *   v1.<user_id>.<exp_unix>.<b64url_mac>
 * MAC = base64url(HMAC-SHA256(secret, user_id + "|" + exp_unix))
 *
 * Edge-safe: uses only Web Crypto (crypto.subtle). No Node builtins.
 */

export const SESSION_FLAG_COOKIE = 'has_session';
export const SESSION_FLAG_VERSION = 'v1';

/** Result of verifying a has_session cookie value. */
export type SessionFlagVerifyResult =
  | { ok: true; userId: string; exp: number }
  | { ok: false; reason: string };

/**
 * Resolve the shared HMAC secret for has_session verification.
 * Prefer HAS_SESSION_SECRET when set (dedicated key); else SESSION_SECRET.
 * Never use a NEXT_PUBLIC_ prefix — the secret must not ship to the client.
 */
export function resolveSessionFlagSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const dedicated = env['HAS_SESSION_SECRET']?.trim();
  if (dedicated) return dedicated;
  return env['SESSION_SECRET']?.trim() ?? '';
}

/**
 * Structural check used by client components (AuthRestorer) that cannot hold
 * the HMAC secret. Accepts any non-empty value that looks like a v1 token OR
 * the legacy pre-SEC-07 literal "1" so in-flight sessions still attempt refresh
 * until the gateway re-issues a signed cookie.
 */
export function looksLikeSessionFlag(value: string | null | undefined): boolean {
  if (value == null || value === '') return false;
  if (value === '1') return true;
  return value.startsWith(`${SESSION_FLAG_VERSION}.`);
}

/**
 * Sign a has_session value (test / tooling helper). Same algorithm as the
 * gateway so vitest can mint valid cookies for middleware tests.
 */
export async function signSessionFlag(
  secret: string,
  userId: string,
  expUnix: number,
): Promise<string> {
  if (!secret) {
    throw new Error('session-flag: empty secret');
  }
  if (!Number.isFinite(expUnix) || expUnix <= 0) {
    throw new Error('session-flag: invalid exp');
  }
  if (userId.includes('.')) {
    throw new Error('session-flag: user_id must not contain "."');
  }
  const expStr = String(Math.trunc(expUnix));
  const mac = await computeMacB64Url(secret, userId, expStr);
  return [SESSION_FLAG_VERSION, userId, expStr, mac].join('.');
}

/**
 * Verify a has_session cookie value. Constant-time MAC compare via
 * crypto.subtle.verify semantics (Web Crypto returns boolean).
 */
export async function verifySessionFlag(
  secret: string,
  value: string,
  nowUnix: number = Math.floor(Date.now() / 1000),
): Promise<SessionFlagVerifyResult> {
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }
  if (!value) {
    return { ok: false, reason: 'empty' };
  }
  // Legacy forgeable constant — always reject for the soft gate.
  if (value === '1') {
    return { ok: false, reason: 'legacy_unsigned' };
  }

  const parts = value.split('.');
  if (parts.length !== 4) {
    return { ok: false, reason: 'malformed' };
  }
  const [version, userId, expStr, providedMac] = parts as [string, string, string, string];
  if (version !== SESSION_FLAG_VERSION) {
    return { ok: false, reason: 'bad_version' };
  }
  if (!expStr || !providedMac) {
    return { ok: false, reason: 'malformed' };
  }

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0 || !Number.isInteger(exp)) {
    return { ok: false, reason: 'bad_exp' };
  }

  const expectedMac = await computeMacB64Url(secret, userId, expStr);
  if (!timingSafeEqualString(expectedMac, providedMac)) {
    return { ok: false, reason: 'bad_mac' };
  }

  if (nowUnix > exp) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, userId, exp };
}

async function computeMacB64Url(
  secret: string,
  userId: string,
  expStr: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8Encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  // Payload must match Go: user_id + "|" + exp
  const payload = utf8Encode(`${userId}|${expStr}`);
  const sig = await crypto.subtle.sign('HMAC', key, payload);
  return base64UrlEncode(new Uint8Array(sig));
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i] as number);
  }
  // btoa is available on edge + Node vitest; strip padding for RawURLEncoding.
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

/** Constant-time string equality for equal-length base64url MACs. */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
