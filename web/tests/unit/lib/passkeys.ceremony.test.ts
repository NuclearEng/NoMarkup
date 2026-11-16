// passkeys — the WebAuthn ceremonies (sign-in + registration). jsdom ships no
// WebAuthn surface, so PublicKeyCredential, the two authenticator response
// classes and navigator.credentials are faked. Pins: the gateway routes and
// bodies, base64url <-> ArrayBuffer conversion of the server options, the
// toJSON fast path versus the manual serialisation fallback, and every
// cancellation / unsupported / failure message.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  base64urlToBuffer,
  bufferToBase64url,
  passkeysSupported,
  registerPasskey,
  signInWithPasskey,
} from '@/lib/passkeys';

vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
    postUnauthed: vi.fn(),
  },
}));

const { api } = await import('@/lib/api');

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function toArray(value: BufferSource | undefined): number[] {
  if (value === undefined) throw new Error('expected a buffer');
  const buffer = value instanceof ArrayBuffer ? value : value.buffer;
  return Array.from(new Uint8Array(buffer));
}

class FakeAttestationResponse {
  clientDataJSON = bytes(1, 2, 3);
  attestationObject = bytes(250, 251, 252);
}

class FakeAssertionResponse {
  clientDataJSON = bytes(4, 5);
  authenticatorData = bytes(6, 7);
  signature = bytes(255, 254);
  userHandle: ArrayBuffer | null;

  constructor(userHandle: ArrayBuffer | null) {
    this.userHandle = userHandle;
  }
}

class FakePublicKeyCredential {
  id = 'cred-id';
  rawId = bytes(9, 8, 7);
  type = 'public-key';
  authenticatorAttachment = 'platform';
  response: unknown;
  toJSON?: () => unknown;

  constructor(response: unknown, toJSON?: () => unknown) {
    this.response = response;
    if (toJSON) this.toJSON = toJSON;
  }

  getClientExtensionResults(): Record<string, unknown> {
    return { credProps: { rk: true } };
  }
}

const credentialsGet = vi.fn();
const credentialsCreate = vi.fn();

function installWebAuthn(): void {
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  vi.stubGlobal('AuthenticatorAttestationResponse', FakeAttestationResponse);
  vi.stubGlobal('AuthenticatorAssertionResponse', FakeAssertionResponse);
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { get: credentialsGet, create: credentialsCreate },
  });
}

const requestEnvelope = {
  publicKey: {
    challenge: bufferToBase64url(bytes(10, 20, 30)),
    timeout: 60000,
    rpId: 'no-markup.com',
    allowCredentials: [
      { type: 'public-key', id: bufferToBase64url(bytes(1, 1, 2)), transports: ['internal'] },
    ],
    userVerification: 'preferred',
  },
};

const creationEnvelope = {
  publicKey: {
    challenge: bufferToBase64url(bytes(40, 50)),
    rp: { id: 'no-markup.com', name: 'NoMarkup' },
    user: { id: bufferToBase64url(bytes(7, 7, 7, 7)), name: 'a@b.co', displayName: 'A B' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    timeout: 30000,
    excludeCredentials: [{ type: 'public-key', id: bufferToBase64url(bytes(3, 4)) }],
    authenticatorSelection: { residentKey: 'required' },
    attestation: 'none',
  },
};

const authResponse = { access_token: 'tok', user: { id: 'u-1' } };

function requestOptionsPassed(): PublicKeyCredentialRequestOptions {
  const arg: unknown = credentialsGet.mock.calls[0]?.[0];
  return (arg as { publicKey: PublicKeyCredentialRequestOptions }).publicKey;
}

function creationOptionsPassed(): PublicKeyCredentialCreationOptions {
  const arg: unknown = credentialsCreate.mock.calls[0]?.[0];
  return (arg as { publicKey: PublicKeyCredentialCreationOptions }).publicKey;
}

describe('passkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'credentials');
  });

  describe('base64url helpers', () => {
    it.each([
      ['', []],
      ['AQ', [1]],
      ['AQI', [1, 2]],
      ['AQID', [1, 2, 3]],
      ['-_8', [251, 255]],
    ])('decodes %j (unpadded, url-safe alphabet)', (encoded, expected) => {
      expect(toArray(base64urlToBuffer(encoded))).toEqual(expected);
    });

    it('encodes without padding and with the url-safe alphabet', () => {
      expect(bufferToBase64url(bytes(251, 255))).toBe('-_8');
      expect(bufferToBase64url(bytes())).toBe('');
    });
  });

  describe('when WebAuthn is unavailable', () => {
    it('reports unsupported and refuses both ceremonies before calling the gateway', async () => {
      expect(passkeysSupported()).toBe(false);

      await expect(signInWithPasskey('a@b.co')).rejects.toThrow(
        'Passkeys are not available in this browser.',
      );
      await expect(registerPasskey()).rejects.toThrow(
        'Passkeys are not available in this browser.',
      );

      expect(vi.mocked(api.postUnauthed)).not.toHaveBeenCalled();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('reports unsupported on the server (no window)', () => {
      vi.stubGlobal('window', undefined);
      expect(passkeysSupported()).toBe(false);
    });
  });

  describe('signInWithPasskey', () => {
    beforeEach(() => {
      installWebAuthn();
    });

    it('is supported once PublicKeyCredential exists', () => {
      expect(passkeysSupported()).toBe(true);
    });

    it.each<[string, string | undefined, Record<string, string>]>([
      ['a trimmed email', '  a@b.co  ', { email: 'a@b.co' }],
      ['no body for an undefined email (discoverable credential)', undefined, {}],
      ['no body for a whitespace-only email', '   ', {}],
    ])('requests assertion options with %s', async (_label, email, body) => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(requestEnvelope);
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(authResponse);
      credentialsGet.mockResolvedValueOnce(
        new FakePublicKeyCredential(new FakeAssertionResponse(null)),
      );

      await signInWithPasskey(email);

      expect(vi.mocked(api.postUnauthed).mock.calls[0]).toStrictEqual([
        '/api/v1/auth/passkeys/assert/options',
        body,
      ]);
    });

    it('converts the server options to buffers and posts the manual assertion JSON', async () => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(requestEnvelope);
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(authResponse);
      credentialsGet.mockResolvedValueOnce(
        new FakePublicKeyCredential(new FakeAssertionResponse(bytes(42, 43))),
      );

      const result = await signInWithPasskey('a@b.co');

      expect(result).toBe(authResponse);
      const publicKey = requestOptionsPassed();
      expect(toArray(publicKey.challenge)).toEqual([10, 20, 30]);
      expect(publicKey.timeout).toBe(60000);
      expect(publicKey.rpId).toBe('no-markup.com');
      expect(publicKey.userVerification).toBe('preferred');
      expect(publicKey.allowCredentials).toHaveLength(1);
      const allowed = publicKey.allowCredentials?.[0];
      expect(allowed?.type).toBe('public-key');
      expect(allowed?.transports).toEqual(['internal']);
      expect(toArray(allowed?.id)).toEqual([1, 1, 2]);

      expect(vi.mocked(api.postUnauthed).mock.calls[1]).toStrictEqual([
        '/api/v1/auth/passkeys/assert/verify',
        {
          id: 'cred-id',
          rawId: bufferToBase64url(bytes(9, 8, 7)),
          type: 'public-key',
          authenticatorAttachment: 'platform',
          response: {
            clientDataJSON: bufferToBase64url(bytes(4, 5)),
            authenticatorData: bufferToBase64url(bytes(6, 7)),
            signature: bufferToBase64url(bytes(255, 254)),
            userHandle: bufferToBase64url(bytes(42, 43)),
          },
          clientExtensionResults: { credProps: { rk: true } },
        },
      ]);
    });

    it('sends userHandle null and omits allowCredentials when the server sends none', async () => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce({ publicKey: { challenge: 'AQID' } });
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(authResponse);
      credentialsGet.mockResolvedValueOnce(
        new FakePublicKeyCredential(new FakeAssertionResponse(null)),
      );

      await signInWithPasskey(undefined);

      const publicKey = requestOptionsPassed();
      expect(publicKey.allowCredentials).toBeUndefined();
      const body = vi.mocked(api.postUnauthed).mock.calls[1]?.[1] as {
        response: { userHandle: string | null };
      };
      expect(body.response.userHandle).toBeNull();
    });

    it('prefers the native toJSON() serialisation when the browser provides it', async () => {
      const native = { id: 'native', response: { clientDataJSON: 'x' } };
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(requestEnvelope);
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(authResponse);
      credentialsGet.mockResolvedValueOnce(
        new FakePublicKeyCredential(new FakeAssertionResponse(null), () => native),
      );

      await signInWithPasskey('a@b.co');

      expect(vi.mocked(api.postUnauthed).mock.calls[1]?.[1]).toBe(native);
    });

    it.each<[string, unknown, string]>([
      [
        'a NotAllowedError (user dismissed the sheet)',
        new DOMException('The operation is not allowed', 'NotAllowedError'),
        'Passkey was cancelled.',
      ],
      ['a plain Error, by its own message', new Error('authenticator timed out'), 'authenticator timed out'],
      ['an Error with an empty message, by the fallback', new Error(''), 'Passkey sign-in failed.'],
      ['a non-Error rejection, by the fallback', 'boom', 'Passkey sign-in failed.'],
    ])('reports %s', async (_label, rejection, message) => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(requestEnvelope);
      credentialsGet.mockRejectedValueOnce(rejection);

      await expect(signInWithPasskey('a@b.co')).rejects.toThrow(new Error(message));

      // Only the options call went out — nothing is verified after a failure.
      expect(vi.mocked(api.postUnauthed)).toHaveBeenCalledTimes(1);
    });

    it('treats a null credential as a cancellation', async () => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(requestEnvelope);
      credentialsGet.mockResolvedValueOnce(null);

      await expect(signInWithPasskey('a@b.co')).rejects.toThrow('Passkey was cancelled.');
      expect(vi.mocked(api.postUnauthed)).toHaveBeenCalledTimes(1);
    });

    it.each<[string, () => unknown]>([
      ['a non-public-key credential (e.g. a password credential)', () => ({ id: 'pw', type: 'password' })],
      [
        'a public-key credential with an unrecognised response type',
        () => new FakePublicKeyCredential({ clientDataJSON: bytes(1) }),
      ],
    ])('rejects %s without verifying', async (_label, makeCredential) => {
      vi.mocked(api.postUnauthed).mockResolvedValueOnce(requestEnvelope);
      credentialsGet.mockResolvedValueOnce(makeCredential());

      await expect(signInWithPasskey('a@b.co')).rejects.toThrow(
        'This browser cannot complete a passkey ceremony.',
      );
      expect(vi.mocked(api.postUnauthed)).toHaveBeenCalledTimes(1);
    });

    it('propagates a gateway failure fetching options without prompting the user', async () => {
      const failure = new Error('429');
      vi.mocked(api.postUnauthed).mockRejectedValueOnce(failure);

      await expect(signInWithPasskey('a@b.co')).rejects.toBe(failure);
      expect(credentialsGet).not.toHaveBeenCalled();
    });
  });

  describe('registerPasskey', () => {
    beforeEach(() => {
      installWebAuthn();
    });

    it('converts creation options to buffers and posts the manual attestation JSON', async () => {
      vi.mocked(api.post).mockResolvedValueOnce(creationEnvelope);
      vi.mocked(api.post).mockResolvedValueOnce({});
      credentialsCreate.mockResolvedValueOnce(
        new FakePublicKeyCredential(new FakeAttestationResponse()),
      );

      await registerPasskey();

      expect(vi.mocked(api.post).mock.calls[0]).toStrictEqual([
        '/api/v1/auth/passkeys/register/options',
        {},
      ]);
      const publicKey = creationOptionsPassed();
      expect(toArray(publicKey.challenge)).toEqual([40, 50]);
      expect(toArray(publicKey.user.id)).toEqual([7, 7, 7, 7]);
      expect(publicKey.user.name).toBe('a@b.co');
      expect(publicKey.user.displayName).toBe('A B');
      expect(publicKey.rp).toEqual({ id: 'no-markup.com', name: 'NoMarkup' });
      expect(publicKey.pubKeyCredParams).toEqual([{ type: 'public-key', alg: -7 }]);
      expect(publicKey.timeout).toBe(30000);
      expect(publicKey.attestation).toBe('none');
      expect(publicKey.authenticatorSelection).toEqual({ residentKey: 'required' });
      expect(publicKey.excludeCredentials).toHaveLength(1);
      expect(toArray(publicKey.excludeCredentials?.[0]?.id)).toEqual([3, 4]);
      expect(publicKey.excludeCredentials?.[0]?.transports).toBeUndefined();

      expect(vi.mocked(api.post).mock.calls[1]).toStrictEqual([
        '/api/v1/auth/passkeys/register/verify',
        {
          id: 'cred-id',
          rawId: bufferToBase64url(bytes(9, 8, 7)),
          type: 'public-key',
          authenticatorAttachment: 'platform',
          response: {
            clientDataJSON: bufferToBase64url(bytes(1, 2, 3)),
            attestationObject: bufferToBase64url(bytes(250, 251, 252)),
          },
          clientExtensionResults: { credProps: { rk: true } },
        },
      ]);
    });

    it('leaves excludeCredentials undefined when the account has no passkeys yet', async () => {
      const { excludeCredentials: _omitted, ...withoutExclude } = creationEnvelope.publicKey;
      vi.mocked(api.post).mockResolvedValueOnce({ publicKey: withoutExclude });
      vi.mocked(api.post).mockResolvedValueOnce({});
      credentialsCreate.mockResolvedValueOnce(
        new FakePublicKeyCredential(new FakeAttestationResponse(), () => ({ id: 'native' })),
      );

      await registerPasskey();

      const publicKey = creationOptionsPassed();
      expect(publicKey.excludeCredentials).toBeUndefined();
      expect(vi.mocked(api.post).mock.calls[1]?.[1]).toEqual({ id: 'native' });
    });

    it.each<[string, unknown, string]>([
      [
        'a NotAllowedError',
        new DOMException('not allowed', 'NotAllowedError'),
        'Passkey was cancelled.',
      ],
      ['a plain Error, by its own message', new Error('authenticator already registered'), 'authenticator already registered'],
      ['a non-Error rejection, by the fallback', { code: 1 }, 'Could not add a passkey.'],
    ])('reports %s', async (_label, rejection, message) => {
      vi.mocked(api.post).mockResolvedValueOnce(creationEnvelope);
      credentialsCreate.mockRejectedValueOnce(rejection);

      await expect(registerPasskey()).rejects.toThrow(new Error(message));
      expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1);
    });

    it('treats a null credential as a cancellation', async () => {
      vi.mocked(api.post).mockResolvedValueOnce(creationEnvelope);
      credentialsCreate.mockResolvedValueOnce(null);

      await expect(registerPasskey()).rejects.toThrow('Passkey was cancelled.');
      expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1);
    });

    it('propagates a verify failure from the gateway', async () => {
      const failure = new Error('challenge expired');
      vi.mocked(api.post).mockResolvedValueOnce(creationEnvelope);
      vi.mocked(api.post).mockRejectedValueOnce(failure);
      credentialsCreate.mockResolvedValueOnce(
        new FakePublicKeyCredential(new FakeAttestationResponse()),
      );

      await expect(registerPasskey()).rejects.toBe(failure);
    });
  });
});
