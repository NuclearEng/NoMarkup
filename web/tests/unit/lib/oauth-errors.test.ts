import { describe, expect, it } from 'vitest';

import { messageForOAuthError } from '@/lib/oauth-errors';

describe('messageForOAuthError', () => {
  it('returns null for empty codes', () => {
    expect(messageForOAuthError(null)).toBeNull();
    expect(messageForOAuthError(undefined)).toBeNull();
    expect(messageForOAuthError('')).toBeNull();
    expect(messageForOAuthError('   ')).toBeNull();
  });

  it('maps google_not_configured', () => {
    const msg = messageForOAuthError('google_not_configured');
    expect(msg).toMatch(/Google sign-in is not configured/i);
    expect(msg).toMatch(/GOOGLE_CLIENT_ID/i);
  });

  it('maps facebook_not_configured', () => {
    const msg = messageForOAuthError('facebook_not_configured');
    expect(msg).toMatch(/Facebook sign-in is not configured/i);
  });

  it('maps apple_not_configured', () => {
    const msg = messageForOAuthError('apple_not_configured');
    expect(msg).toMatch(/Apple sign-in is not configured/i);
  });

  it('is case-insensitive', () => {
    expect(messageForOAuthError('ACCESS_DENIED')).toMatch(/cancelled/i);
  });

  it('falls back for unknown codes', () => {
    const msg = messageForOAuthError('some_provider_quirk');
    expect(msg).toMatch(/Could not connect/i);
    expect(msg).toMatch(/some_provider_quirk/);
  });
});
