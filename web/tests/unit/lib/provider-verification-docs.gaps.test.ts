// provider-verification-docs — size and status formatting, legacy document
// type keys, and expiry maths around bad dates and the 30-day boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_DOCUMENT_SIZE_BYTES,
  daysUntilExpiry,
  documentTypeLabel,
  formatDocStatus,
  formatDocumentSize,
  isDocumentExpired,
  isDocumentExpiringSoon,
} from '@/lib/provider-verification-docs';

describe('formatDocumentSize', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024 - 1, '1024.0 KB'],
    [1024 * 1024, '1.0 MB'],
    [MAX_DOCUMENT_SIZE_BYTES, '10.0 MB'],
  ])('%d bytes → %s', (bytes, label) => {
    expect(formatDocumentSize(bytes)).toBe(label);
  });
});

describe('formatDocStatus', () => {
  it('is empty for a missing status', () => {
    expect(formatDocStatus(undefined)).toBe('');
    expect(formatDocStatus('')).toBe('');
  });

  it('replaces every underscore with a space', () => {
    expect(formatDocStatus('pending_manual_review')).toBe('pending manual review');
  });
});

describe('documentTypeLabel', () => {
  it.each([
    [undefined, 'Document'],
    ['', 'Document'],
    ['insurance', 'Proof of Insurance'],
    ['government_id', "Driver's License or Government ID"],
    ['proof_of_insurance', 'Proof of Insurance'],
    ['w9_form', 'W9 Form'],
    ['bond', 'Bond'],
  ])('%j → %s', (key, label) => {
    expect(documentTypeLabel(key)).toBe(label);
  });
});

describe('expiry helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([undefined, null, '', 'not-a-date'])('%j has no expiry: neither expired nor expiring', (value) => {
    expect(daysUntilExpiry(value)).toBeNull();
    expect(isDocumentExpired(value)).toBe(false);
    expect(isDocumentExpiringSoon(value)).toBe(false);
  });

  it('rounds partial days up, so a document expiring later today has 1 day left', () => {
    expect(daysUntilExpiry('2026-03-01T18:00:00Z')).toBe(1);
    expect(isDocumentExpired('2026-03-01T18:00:00Z')).toBe(false);
    expect(isDocumentExpiringSoon('2026-03-01T18:00:00Z')).toBe(true);
  });

  it('a document that lapsed under a day ago is already expired', () => {
    const value = '2026-03-01T06:00:00Z';
    expect(daysUntilExpiry(value)).toBe(-1);
    expect(isDocumentExpired(value)).toBe(true);
    expect(isDocumentExpiringSoon(value)).toBe(false);
  });

  it('is expired once a full day has passed', () => {
    expect(daysUntilExpiry('2026-02-27T12:00:00Z')).toBe(-2);
    expect(isDocumentExpired('2026-02-27T12:00:00Z')).toBe(true);
    expect(isDocumentExpiringSoon('2026-02-27T12:00:00Z')).toBe(false);
  });

  it('treats exactly 30 days as expiring soon and 31 as not', () => {
    expect(daysUntilExpiry('2026-03-31T12:00:00Z')).toBe(30);
    expect(isDocumentExpiringSoon('2026-03-31T12:00:00Z')).toBe(true);
    expect(daysUntilExpiry('2026-04-01T12:00:00Z')).toBe(31);
    expect(isDocumentExpiringSoon('2026-04-01T12:00:00Z')).toBe(false);
  });
});
