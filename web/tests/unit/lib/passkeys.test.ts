import { describe, expect, it } from 'vitest';

import { base64urlToBuffer, bufferToBase64url } from '@/lib/passkeys';

describe('passkey base64url', () => {
  it('round-trips bytes that include the url-safe alphabet', () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 1, 2, 3]);
    const encoded = bufferToBase64url(bytes.buffer);
    expect(encoded).not.toMatch(/[+/=]/u);
    const decoded = new Uint8Array(base64urlToBuffer(encoded));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});
