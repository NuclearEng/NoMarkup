import { describe, expect, it } from 'vitest';

import { safeInternalPath } from '@/lib/safe-internal-path';

describe('safeInternalPath', () => {
  it('returns the fallback for empty or missing values', () => {
    expect(safeInternalPath(null)).toBe('/dashboard');
    expect(safeInternalPath(undefined)).toBe('/dashboard');
    expect(safeInternalPath('')).toBe('/dashboard');
    expect(safeInternalPath('   ')).toBe('/dashboard');
  });

  it('accepts same-origin relative paths', () => {
    expect(safeInternalPath('/orders')).toBe('/orders');
    expect(safeInternalPath('/marketplace/abc?tab=pay')).toBe('/marketplace/abc?tab=pay');
  });

  it('rejects protocol-relative and absolute URLs', () => {
    expect(safeInternalPath('//evil.example/phish')).toBe('/dashboard');
    expect(safeInternalPath('https://evil.example/phish')).toBe('/dashboard');
    expect(safeInternalPath('javascript:alert(1)')).toBe('/dashboard');
  });

  it('decodes a URI-encoded relative path', () => {
    expect(safeInternalPath('%2Forders')).toBe('/orders');
  });
});
