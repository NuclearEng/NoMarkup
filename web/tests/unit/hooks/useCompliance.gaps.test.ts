// useCompliance — consent-cookie edge cases (no document on the server,
// session id, malformed value, Secure on https), bid-bond failure toasts and
// sticky keys, and the null paths of extractBidBondRequirement.
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONSENT_COOKIE_NAME,
  extractBidBondRequirement,
  hasAnalyticsConsent,
  hasConsentCookie,
  isBidBondRequirement,
  readConsentCookie,
  useConfirmBidBond,
  useCreateBidBond,
  writeConsentCookie,
} from '@/hooks/useCompliance';

import { type QueryHarness, createQueryHarness } from './_gaps-query-harness';

const mocks = vi.hoisted(() => ({
  post: vi.fn<(path: string, body?: unknown, headers?: Record<string, string>) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn(), post: mocks.post, put: vi.fn() } };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { ApiError, __resetIdempotencyKeysForTests } = await import('@/lib/api');
const { toast } = await import('sonner');

let h: QueryHarness;

function clearConsentCookie(): void {
  document.cookie = `${CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`;
}

function setRawConsentCookie(raw: string): void {
  document.cookie = `${CONSENT_COOKIE_NAME}=${raw}; Path=/`;
}

function sentKeys(): (string | undefined)[] {
  return mocks.post.mock.calls.map((call) => call[2]?.['Idempotency-Key']);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetIdempotencyKeysForTests();
  clearConsentCookie();
  h = createQueryHarness();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearConsentCookie();
  h.queryClient.clear();
});

describe('consent cookie — reading', () => {
  it('keeps a string session_id and coerces the three flags to strict booleans', () => {
    setRawConsentCookie(
      encodeURIComponent(
        JSON.stringify({ necessary: true, analytics: 'yes', marketing: 1, session_id: 'sess-9' }),
      ),
    );
    expect(readConsentCookie()).toEqual({
      necessary: true,
      analytics: false,
      marketing: false,
      session_id: 'sess-9',
    });
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('drops a session_id that is not a string', () => {
    setRawConsentCookie(encodeURIComponent(JSON.stringify({ necessary: true, session_id: 42 })));
    expect(readConsentCookie()).toEqual({ necessary: true, analytics: false, marketing: false });
  });

  it('treats a malformed value as no consent while still reporting that a cookie exists', () => {
    setRawConsentCookie('%7Bnot-json');
    expect(hasConsentCookie()).toBe(true);
    expect(readConsentCookie()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('finds the consent cookie among other cookies', () => {
    document.cookie = 'theme=dark; Path=/';
    writeConsentCookie({ necessary: true, analytics: true, marketing: false });
    expect(readConsentCookie()).toEqual({ necessary: true, analytics: true, marketing: false });
    expect(hasAnalyticsConsent()).toBe(true);
    document.cookie = 'theme=; Max-Age=0; Path=/';
  });
});

describe('consent cookie — writing', () => {
  it('adds Secure on https and a 12-month lifetime', () => {
    const setCookie = vi.spyOn(document, 'cookie', 'set');
    vi.stubGlobal('location', { protocol: 'https:' });

    writeConsentCookie({ necessary: true, analytics: false, marketing: false });

    const value = encodeURIComponent(
      JSON.stringify({ necessary: true, analytics: false, marketing: false }),
    );
    expect(setCookie).toHaveBeenCalledWith(
      `nm:consent=${value}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`,
    );
  });

  it('omits Secure on http', () => {
    const setCookie = vi.spyOn(document, 'cookie', 'set');
    vi.stubGlobal('location', { protocol: 'http:' });

    writeConsentCookie({ necessary: true, analytics: true, marketing: true });

    expect(setCookie).toHaveBeenCalledTimes(1);
    expect(setCookie.mock.calls[0]?.[0]).toMatch(/; SameSite=Lax$/);
  });
});

describe('consent cookie — no document (server render)', () => {
  it('reports no consent and writes nothing', () => {
    writeConsentCookie({ necessary: true, analytics: true, marketing: false });
    const setCookie = vi.spyOn(document, 'cookie', 'set');
    vi.stubGlobal('document', undefined);

    const seen = {
      has: hasConsentCookie(),
      read: readConsentCookie(),
      analytics: hasAnalyticsConsent(),
    };
    writeConsentCookie({ necessary: true, analytics: false, marketing: false });
    vi.unstubAllGlobals();

    expect(seen).toEqual({ has: false, read: null, analytics: false });
    expect(setCookie).not.toHaveBeenCalled();
    // The browser cookie written before the stub is untouched.
    expect(hasAnalyticsConsent()).toBe(true);
  });
});

describe('bid bond mutations — failures', () => {
  it('create: toasts the gateway reason and reuses the key on retry; a new amount gets a new key', async () => {
    mocks.post.mockRejectedValue(new ApiError(409, '{"error":"auction has ended"}'));
    const { result } = renderHook(() => useCreateBidBond(), { wrapper: h.wrapper });
    const variables = { listingId: 'l-1', input: { intended_bid_cents: 50_000 } };

    await expect(result.current.mutateAsync(variables)).rejects.toBeInstanceOf(ApiError);
    await expect(result.current.mutateAsync(variables)).rejects.toBeInstanceOf(ApiError);
    await expect(
      result.current.mutateAsync({ listingId: 'l-1', input: { intended_bid_cents: 60_000 } }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(toast.error).toHaveBeenCalledWith('auction has ended');
    const [first, retry, otherAmount] = sentKeys();
    expect(first).toEqual(expect.any(String));
    expect(retry).toBe(first);
    expect(otherAmount).not.toBe(first);
  });

  it('create: toasts the fallback when the failure carries no message', async () => {
    mocks.post.mockRejectedValue('nope');
    const { result } = renderHook(() => useCreateBidBond(), { wrapper: h.wrapper });

    await expect(
      result.current.mutateAsync({ listingId: 'l-1', input: { intended_bid_cents: 50_000 } }),
    ).rejects.toBe('nope');

    expect(toast.error).toHaveBeenCalledWith('Failed to create bid bond');
  });

  it('create: a success releases the key so the next bond attempt is a new operation', async () => {
    mocks.post.mockResolvedValue({ bond_id: 'b-1', setup_intent_client_secret: 's', bond_amount_cents: 500 });
    const { result } = renderHook(() => useCreateBidBond(), { wrapper: h.wrapper });
    const variables = { listingId: 'l-1', input: { intended_bid_cents: 50_000 } };

    await result.current.mutateAsync(variables);
    await result.current.mutateAsync(variables);

    const [first, second] = sentKeys();
    expect(second).not.toBe(first);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('confirm: toasts the gateway reason and keeps the key for the retry', async () => {
    mocks.post.mockRejectedValue(new ApiError(402, '{"error":"card authorization failed"}'));
    const { result } = renderHook(() => useConfirmBidBond(), { wrapper: h.wrapper });
    const variables = { listingId: 'l-1', bondId: 'b-1' };

    await expect(result.current.mutateAsync(variables)).rejects.toBeInstanceOf(ApiError);
    await expect(result.current.mutateAsync(variables)).rejects.toBeInstanceOf(ApiError);

    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1/listings/l-1/bid-bond/confirm',
      { bond_id: 'b-1' },
      { 'Idempotency-Key': expect.any(String) as string },
    );
    expect(toast.error).toHaveBeenCalledWith('card authorization failed');
    const [first, retry] = sentKeys();
    expect(retry).toBe(first);
  });

  it('confirm: toasts the fallback for a failure with no message', async () => {
    mocks.post.mockRejectedValue(new Error(''));
    const { result } = renderHook(() => useConfirmBidBond(), { wrapper: h.wrapper });

    await expect(result.current.mutateAsync({ listingId: 'l-1', bondId: 'b-1' })).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith('Failed to confirm bid bond');
  });
});

describe('extractBidBondRequirement / isBidBondRequirement — null paths', () => {
  const body = JSON.stringify({ requires_bid_bond: true, bond_amount_cents: 2500 });

  it('returns null for anything that is not an ApiError', () => {
    expect(extractBidBondRequirement(new Error(body))).toBeNull();
    expect(extractBidBondRequirement({ status: 402, body })).toBeNull();
    expect(extractBidBondRequirement(null)).toBeNull();
  });

  it('returns null for a non-402 even when the body looks like a requirement', () => {
    expect(extractBidBondRequirement(new ApiError(403, body))).toBeNull();
    expect(isBidBondRequirement(new ApiError(403, body))).toBe(false);
  });

  it('returns null when the amount is missing or not a number, though the flag is set', () => {
    const noAmount = new ApiError(402, JSON.stringify({ requires_bid_bond: true }));
    const textAmount = new ApiError(
      402,
      JSON.stringify({ requires_bid_bond: true, bond_amount_cents: '2500' }),
    );
    expect(isBidBondRequirement(noAmount)).toBe(true);
    expect(extractBidBondRequirement(noAmount)).toBeNull();
    expect(extractBidBondRequirement(textAmount)).toBeNull();
  });

  it('treats a 402 with a non-JSON body as not a bond requirement', () => {
    expect(isBidBondRequirement(new ApiError(402, 'Payment Required'))).toBe(false);
  });

  it('returns only the two documented fields', () => {
    const err = new ApiError(
      402,
      JSON.stringify({ requires_bid_bond: true, bond_amount_cents: 2500, error: 'bond required' }),
    );
    expect(extractBidBondRequirement(err)).toEqual({
      requires_bid_bond: true,
      bond_amount_cents: 2500,
    });
  });
});
