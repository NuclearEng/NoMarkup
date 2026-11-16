// session-flag — sign-time input validation and the verify rejections the
// main test does not reach (empty fields, bad exp shapes, wrong-length MAC).
import { describe, expect, it } from 'vitest';

import {
  looksLikeSessionFlag,
  resolveSessionFlagSecret,
  signSessionFlag,
  verifySessionFlag,
} from '@/lib/session-flag';

const SECRET = 'test-secret-with-enough-entropy';
const EXP = 2_000_000_000;
const NOW = 1_900_000_000;

describe('signSessionFlag — input validation', () => {
  it('refuses an empty secret', async () => {
    await expect(signSessionFlag('', 'user-1', EXP)).rejects.toThrow('session-flag: empty secret');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses exp %s', async (exp) => {
    await expect(signSessionFlag(SECRET, 'user-1', exp)).rejects.toThrow('session-flag: invalid exp');
  });

  it('refuses a user id containing the field separator', async () => {
    await expect(signSessionFlag(SECRET, 'user.1', EXP)).rejects.toThrow(
      'session-flag: user_id must not contain "."',
    );
  });

  it('truncates a fractional exp so the wire value stays a 4-field token that verifies', async () => {
    const value = await signSessionFlag(SECRET, 'user-1', EXP + 0.9);
    expect(value.split('.')).toHaveLength(4);
    expect(value.split('.')[2]).toBe(String(EXP));
    await expect(verifySessionFlag(SECRET, value, NOW)).resolves.toEqual({
      ok: true,
      userId: 'user-1',
      exp: EXP,
    });
  });
});

describe('verifySessionFlag — rejections', () => {
  async function signedParts(): Promise<[string, string, string, string]> {
    const value = await signSessionFlag(SECRET, 'user-1', EXP);
    const [version = '', userId = '', exp = '', mac = ''] = value.split('.');
    return [version, userId, exp, mac];
  }

  it.each([
    ['an empty exp field', 'v1.user-1..abc'],
    ['an empty MAC field', `v1.user-1.${String(EXP)}.`],
  ])('%s is malformed', async (_name, value) => {
    await expect(verifySessionFlag(SECRET, value, NOW)).resolves.toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects another version before looking at anything else', async () => {
    const [, userId, exp, mac] = await signedParts();
    await expect(verifySessionFlag(SECRET, `v2.${userId}.${exp}.${mac}`, NOW)).resolves.toEqual({
      ok: false,
      reason: 'bad_version',
    });
  });

  it.each(['abc', '0', '-5', 'Infinity', '1e-1'])('exp %j is bad_exp', async (exp) => {
    const [version, userId, , mac] = await signedParts();
    await expect(verifySessionFlag(SECRET, `${version}.${userId}.${exp}.${mac}`, NOW)).resolves.toEqual({
      ok: false,
      reason: 'bad_exp',
    });
  });

  it('rejects a MAC of the wrong length', async () => {
    const [version, userId, exp, mac] = await signedParts();
    await expect(
      verifySessionFlag(SECRET, `${version}.${userId}.${exp}.${mac.slice(0, -1)}`, NOW),
    ).resolves.toEqual({ ok: false, reason: 'bad_mac' });
    await expect(
      verifySessionFlag(SECRET, `${version}.${userId}.${exp}.${mac}A`, NOW),
    ).resolves.toEqual({ ok: false, reason: 'bad_mac' });
  });

  it('rejects a MAC that was signed for a different user or a later exp', async () => {
    const [version, , exp, mac] = await signedParts();
    await expect(verifySessionFlag(SECRET, `${version}.admin.${exp}.${mac}`, NOW)).resolves.toEqual({
      ok: false,
      reason: 'bad_mac',
    });
    await expect(
      verifySessionFlag(SECRET, `${version}.user-1.${String(EXP + 1)}.${mac}`, NOW),
    ).resolves.toEqual({ ok: false, reason: 'bad_mac' });
  });

  it('is still valid at exactly exp and expired one second later', async () => {
    const value = await signSessionFlag(SECRET, 'user-1', EXP);
    await expect(verifySessionFlag(SECRET, value, EXP)).resolves.toMatchObject({ ok: true });
    await expect(verifySessionFlag(SECRET, value, EXP + 1)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});

describe('resolveSessionFlagSecret / looksLikeSessionFlag', () => {
  it('falls back to SESSION_SECRET when the dedicated secret is blank, trimming both', () => {
    expect(resolveSessionFlagSecret({ HAS_SESSION_SECRET: '   ', SESSION_SECRET: ' shared ' })).toBe('shared');
    expect(resolveSessionFlagSecret({ HAS_SESSION_SECRET: ' dedicated ' })).toBe('dedicated');
  });

  it('is empty when neither secret is set', () => {
    expect(resolveSessionFlagSecret({})).toBe('');
  });

  it.each([
    [null, false],
    [undefined, false],
    ['', false],
    ['0', false],
    ['v2.user.1.mac', false],
    ['1', true],
    ['v1.anything', true],
  ])('looksLikeSessionFlag(%j) = %s', (value, expected) => {
    expect(looksLikeSessionFlag(value)).toBe(expected);
  });
});
