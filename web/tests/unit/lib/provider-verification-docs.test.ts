import { describe, expect, it } from 'vitest';

import {
  documentTypeLabel,
  isDocumentExpired,
  isDocumentExpiringSoon,
  PROVIDER_DOCUMENT_TYPES,
} from '@/lib/provider-verification-docs';

describe('provider-verification-docs', () => {
  it('uses server/iOS wire keys', () => {
    const keys = PROVIDER_DOCUMENT_TYPES.map((t) => t.key);
    expect(keys).toEqual([
      'drivers_license',
      'business_license',
      'ein',
      'insurance',
      'trade_license',
    ]);
    expect(keys).not.toContain('government_id');
    expect(keys).not.toContain('proof_of_insurance');
  });

  it('labels known and legacy types', () => {
    expect(documentTypeLabel('drivers_license')).toMatch(/license|id/i);
    expect(documentTypeLabel('government_id')).toMatch(/license|id/i);
    expect(documentTypeLabel('proof_of_insurance')).toMatch(/insurance/i);
  });

  it('detects expiry windows', () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const far = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(isDocumentExpired(past)).toBe(true);
    expect(isDocumentExpiringSoon(soon)).toBe(true);
    expect(isDocumentExpiringSoon(far)).toBe(false);
    expect(isDocumentExpired(undefined)).toBe(false);
  });
});
