// Verification document expiry — a document that lapsed less than a day ago
// is expired. Math.ceil of a negative fraction is -0, which used to read as
// "expires today" and showed the document as expiring soon.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  daysUntilExpiry,
  isDocumentExpired,
  isDocumentExpiringSoon,
} from '@/lib/provider-verification-docs';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('document expiry around now', () => {
  it.each([
    ['one second ago', '2026-03-01T11:59:59Z', -1],
    ['six hours ago', '2026-03-01T06:00:00Z', -1],
    ['exactly one day ago', '2026-02-28T12:00:00Z', -1],
    ['a day and a half ago', '2026-02-28T00:00:00Z', -2],
    ['exactly two days ago', '2026-02-27T12:00:00Z', -2],
  ])('expired %s → %s is expired, not expiring soon', (_label, expiresAt, days) => {
    expect(daysUntilExpiry(expiresAt)).toBe(days);
    expect(isDocumentExpired(expiresAt)).toBe(true);
    expect(isDocumentExpiringSoon(expiresAt)).toBe(false);
  });

  it.each([
    ['right now', '2026-03-01T12:00:00Z', 0],
    ['in one second', '2026-03-01T12:00:01Z', 1],
    ['in six hours', '2026-03-01T18:00:00Z', 1],
    ['in exactly one day', '2026-03-02T12:00:00Z', 1],
    ['in exactly 30 days', '2026-03-31T12:00:00Z', 30],
  ])('expiring %s → %s is expiring soon, not expired', (_label, expiresAt, days) => {
    expect(daysUntilExpiry(expiresAt)).toBe(days);
    expect(isDocumentExpired(expiresAt)).toBe(false);
    expect(isDocumentExpiringSoon(expiresAt)).toBe(true);
  });

  it('never returns negative zero', () => {
    expect(Object.is(daysUntilExpiry('2026-03-01T06:00:00Z'), -0)).toBe(false);
    expect(Object.is(daysUntilExpiry('2026-03-01T12:00:00Z'), -0)).toBe(false);
  });

  it('31 days out is neither expired nor expiring soon', () => {
    expect(daysUntilExpiry('2026-04-01T12:00:00Z')).toBe(31);
    expect(isDocumentExpiringSoon('2026-04-01T12:00:00Z')).toBe(false);
  });

  it('a missing or unparseable date is neither', () => {
    for (const value of [undefined, null, '', 'not-a-date']) {
      expect(daysUntilExpiry(value)).toBeNull();
      expect(isDocumentExpired(value)).toBe(false);
      expect(isDocumentExpiringSoon(value)).toBe(false);
    }
  });
});
