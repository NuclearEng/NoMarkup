import { afterEach, describe, expect, it } from 'vitest';

import {
  looksLikeSessionFlag,
  resolveSessionFlagSecret,
  signSessionFlag,
  verifySessionFlag,
} from '@/lib/session-flag';

const SECRET = 'test-session-secret-for-sec07-hmac';
const USER = '550e8400-e29b-41d4-a716-446655440000';

describe('session-flag (SEC-07)', () => {
  afterEach(() => {
    // no env stubs to clean in most tests
  });

  it('round-trips a valid signed flag', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const value = await signSessionFlag(SECRET, USER, exp);
    const result = await verifySessionFlag(SECRET, value);
    expect(result).toEqual({ ok: true, userId: USER, exp });
  });

  it('rejects a forged MAC', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const value = await signSessionFlag(SECRET, USER, exp);
    const parts = value.split('.');
    parts[3] = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const forged = parts.join('.');
    const result = await verifySessionFlag(SECRET, forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_mac');
  });

  it('rejects when signed with a different secret', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const value = await signSessionFlag(SECRET, USER, exp);
    const result = await verifySessionFlag('other-secret-value-xxxxx', value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_mac');
  });

  it('rejects an expired flag', async () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const value = await signSessionFlag(SECRET, USER, exp);
    const result = await verifySessionFlag(SECRET, value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects the legacy forgeable has_session=1 value', async () => {
    const result = await verifySessionFlag(SECRET, '1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('legacy_unsigned');
  });

  it('rejects empty secret / empty value', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const value = await signSessionFlag(SECRET, USER, exp);
    expect((await verifySessionFlag('', value)).ok).toBe(false);
    expect((await verifySessionFlag(SECRET, '')).ok).toBe(false);
  });

  it('rejects malformed wire values', async () => {
    expect((await verifySessionFlag(SECRET, 'v1.only.two')).ok).toBe(false);
    expect((await verifySessionFlag(SECRET, 'v2.u.1.mac')).ok).toBe(false);
    expect((await verifySessionFlag(SECRET, 'not-a-token')).ok).toBe(false);
  });

  it('looksLikeSessionFlag accepts v1 tokens and legacy 1', () => {
    expect(looksLikeSessionFlag('1')).toBe(true);
    expect(looksLikeSessionFlag('v1.uid.123.mac')).toBe(true);
    expect(looksLikeSessionFlag('')).toBe(false);
    expect(looksLikeSessionFlag(null)).toBe(false);
    expect(looksLikeSessionFlag('random')).toBe(false);
  });

  it('resolveSessionFlagSecret prefers HAS_SESSION_SECRET', () => {
    expect(
      resolveSessionFlagSecret({
        HAS_SESSION_SECRET: ' dedicated ',
        SESSION_SECRET: 'shared',
      }),
    ).toBe('dedicated');
    expect(resolveSessionFlagSecret({ SESSION_SECRET: ' shared ' })).toBe('shared');
    expect(resolveSessionFlagSecret({})).toBe('');
  });

  it('matches the Go golden vector (wire interop)', async () => {
    const secret = 'golden-session-secret-for-sec07';
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const exp = 1893456000; // 2030-01-01 UTC
    const want =
      'v1.550e8400-e29b-41d4-a716-446655440000.1893456000.yGwjJNegomL9GGKPkqwwiQv30wLPiMePIYkSx_ExFN0';
    await expect(signSessionFlag(secret, userId, exp)).resolves.toBe(want);
    await expect(verifySessionFlag(secret, want, 1_700_000_000)).resolves.toEqual({
      ok: true,
      userId,
      exp,
    });
  });
});
