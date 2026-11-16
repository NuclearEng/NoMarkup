import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SITE_URL, siteUrl } from '@/lib/site-url';

describe('siteUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the configured origin', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.example.test');
    expect(siteUrl()).toBe('https://staging.example.test');
  });

  it('falls back to the default when the variable is empty, as in an image built without the build argument', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(siteUrl()).toBe(DEFAULT_SITE_URL);
    expect(() => new URL(siteUrl())).not.toThrow();
  });

  it('falls back to the default when the variable is only whitespace', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '   ');
    expect(siteUrl()).toBe(DEFAULT_SITE_URL);
  });
});
