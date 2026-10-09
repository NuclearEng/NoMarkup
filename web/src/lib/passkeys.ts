import { api } from '@/lib/api';
import type { AuthResponse } from '@/types';

/**
 * Browser WebAuthn client for the gateway passkey routes.
 * Shapes match go-webauthn: `{ publicKey: options }` in, credential JSON out.
 * The `passkeys` flag gates every caller. This module does not decide visibility.
 */

interface ServerCredentialDescriptor {
  type: PublicKeyCredentialType;
  id: string;
  transports?: AuthenticatorTransport[];
}

interface ServerCreationOptions {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: ServerCredentialDescriptor[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}

interface ServerRequestOptions {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: ServerCredentialDescriptor[];
  userVerification?: UserVerificationRequirement;
}

interface CreationEnvelope {
  publicKey: ServerCreationOptions;
}

interface RequestEnvelope {
  publicKey: ServerRequestOptions;
}

export function base64urlToBuffer(value: string): ArrayBuffer {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}

function descriptor(cred: ServerCredentialDescriptor): PublicKeyCredentialDescriptor {
  return {
    type: cred.type,
    id: base64urlToBuffer(cred.id),
    transports: cred.transports,
  };
}

function toCreationOptions(options: ServerCreationOptions): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64urlToBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: base64urlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    excludeCredentials: options.excludeCredentials?.map(descriptor),
    authenticatorSelection: options.authenticatorSelection,
    attestation: options.attestation,
  };
}

function toRequestOptions(options: ServerRequestOptions): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64urlToBuffer(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    allowCredentials: options.allowCredentials?.map(descriptor),
    userVerification: options.userVerification,
  };
}

function credentialJSON(credential: Credential): unknown {
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('This browser cannot complete a passkey ceremony.');
  }
  const maybeJSON = credential as PublicKeyCredential & { toJSON?: () => unknown };
  if (typeof maybeJSON.toJSON === 'function') {
    return maybeJSON.toJSON();
  }
  const response = credential.response;
  if (response instanceof AuthenticatorAttestationResponse) {
    return {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        attestationObject: bufferToBase64url(response.attestationObject),
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }
  if (response instanceof AuthenticatorAssertionResponse) {
    return {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        authenticatorData: bufferToBase64url(response.authenticatorData),
        signature: bufferToBase64url(response.signature),
        userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }
  throw new Error('This browser cannot complete a passkey ceremony.');
}

function passkeyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Passkey was cancelled.';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export async function signInWithPasskey(email: string | undefined): Promise<AuthResponse> {
  if (!passkeysSupported()) {
    throw new Error('Passkeys are not available in this browser.');
  }
  const trimmed = email?.trim() ?? '';
  const options = await api.postUnauthed<RequestEnvelope>(
    '/api/v1/auth/passkeys/assert/options',
    trimmed === '' ? {} : { email: trimmed },
  );
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: toRequestOptions(options.publicKey),
    });
  } catch (error) {
    throw new Error(passkeyErrorMessage(error, 'Passkey sign-in failed.'));
  }
  if (!credential) {
    throw new Error('Passkey was cancelled.');
  }
  return api.postUnauthed<AuthResponse>(
    '/api/v1/auth/passkeys/assert/verify',
    credentialJSON(credential),
  );
}

export async function registerPasskey(): Promise<void> {
  if (!passkeysSupported()) {
    throw new Error('Passkeys are not available in this browser.');
  }
  const options = await api.post<CreationEnvelope>('/api/v1/auth/passkeys/register/options', {});
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: toCreationOptions(options.publicKey),
    });
  } catch (error) {
    throw new Error(passkeyErrorMessage(error, 'Could not add a passkey.'));
  }
  if (!credential) {
    throw new Error('Passkey was cancelled.');
  }
  await api.post<void>('/api/v1/auth/passkeys/register/verify', credentialJSON(credential));
}
