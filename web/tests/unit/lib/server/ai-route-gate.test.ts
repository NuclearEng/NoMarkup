// ai-route-gate — auth + per-user rate limit for the paid-LLM proxy routes.
// Pins the token sources (Bearer header first, then the oauth_access_token
// cookie, never a session-indicator cookie), fail-closed 401s, the rate-limit
// key and budget, and the 429 + Retry-After response.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gateAiRoute, type AiRouteGateResult } from '@/lib/server/ai-route-gate';
import { consumeRateLimit } from '@/lib/server/rate-limit';
import { verifyAccessToken } from '@/lib/server/verify-jwt';

vi.mock('@/lib/server/rate-limit', () => ({
  consumeRateLimit: vi.fn(),
}));

vi.mock('@/lib/server/verify-jwt', () => ({
  verifyAccessToken: vi.fn(),
}));

function requestWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('https://no-markup.com/api/analyze-job-image', {
    method: 'POST',
    headers,
  });
}

function claimsFor(sub: string) {
  return {
    ok: true as const,
    claims: { sub, exp: 1_900_000_000, iss: 'nomarkup', aud: 'nomarkup-web' },
  };
}

async function rejection(result: AiRouteGateResult): Promise<{
  status: number;
  body: unknown;
  retryAfter: string | null;
}> {
  if (result.ok) throw new Error('expected the gate to reject');
  const body: unknown = await result.response.json();
  return {
    status: result.response.status,
    body,
    retryAfter: result.response.headers.get('Retry-After'),
  };
}

describe('gateAiRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAccessToken).mockReturnValue(claimsFor('user-1'));
    vi.mocked(consumeRateLimit).mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  });

  it.each<[string, string]>([
    ['a standard Bearer header', 'Bearer jwt.abc.def'],
    ['a lower-case scheme', 'bearer jwt.abc.def'],
    ['extra whitespace around the header', '  Bearer   jwt.abc.def  '],
  ])('verifies the token from %s and returns the subject', (_label, authorization) => {
    const result = gateAiRoute(requestWith({ authorization }));

    expect(result).toEqual({ ok: true, userId: 'user-1' });
    expect(vi.mocked(verifyAccessToken)).toHaveBeenCalledWith('jwt.abc.def');
  });

  it('rate-limits per user at 10 requests a minute', () => {
    gateAiRoute(requestWith({ authorization: 'Bearer jwt.abc.def' }));

    expect(vi.mocked(consumeRateLimit).mock.calls).toEqual([
      ['ai-analyze:user-1', { limit: 10, windowMs: 60_000 }],
    ]);
  });

  it('prefers the Bearer header over the oauth cookie', () => {
    gateAiRoute(
      requestWith({ authorization: 'Bearer header.jwt', cookie: 'oauth_access_token=cookie.jwt' }),
    );

    expect(vi.mocked(verifyAccessToken)).toHaveBeenCalledWith('header.jwt');
  });

  it.each<[string, Record<string, string>]>([
    ['there is no Authorization header', { cookie: 'oauth_access_token=cookie.jwt' }],
    [
      'the Authorization header is not a Bearer token',
      { authorization: 'Basic dXNlcjpwYXNz', cookie: 'oauth_access_token=cookie.jwt' },
    ],
    [
      'the Bearer header carries more than one token',
      { authorization: 'Bearer a b', cookie: 'oauth_access_token=cookie.jwt' },
    ],
  ])('falls back to the oauth_access_token cookie when %s', (_label, headers) => {
    const result = gateAiRoute(requestWith(headers));

    expect(result).toEqual({ ok: true, userId: 'user-1' });
    expect(vi.mocked(verifyAccessToken)).toHaveBeenCalledWith('cookie.jwt');
  });

  it.each<[string, Record<string, string>]>([
    ['no credentials at all', {}],
    ['only session-indicator cookies', { cookie: 'has_session=1; refresh_token=opaque' }],
    ['a bare "Bearer" with no token', { authorization: 'Bearer' }],
    ['a non-Bearer scheme and no cookie', { authorization: 'Token abc' }],
    ['an empty oauth cookie', { cookie: 'oauth_access_token=' }],
  ])('rejects %s with 401 without verifying or consuming budget', async (_label, headers) => {
    const result = gateAiRoute(requestWith(headers));

    await expect(rejection(result)).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized' },
      retryAfter: null,
    });
    expect(vi.mocked(verifyAccessToken)).not.toHaveBeenCalled();
    expect(vi.mocked(consumeRateLimit)).not.toHaveBeenCalled();
  });

  it('rejects a token that fails verification with 401, hiding the reason, and spends no budget', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ ok: false, reason: 'token expired' });

    const result = gateAiRoute(requestWith({ authorization: 'Bearer expired.jwt' }));

    await expect(rejection(result)).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized' },
      retryAfter: null,
    });
    expect(vi.mocked(consumeRateLimit)).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After once the user is over budget', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue(claimsFor('user-9'));
    vi.mocked(consumeRateLimit).mockReturnValue({ allowed: false, retryAfterSeconds: 37 });

    const result = gateAiRoute(requestWith({ authorization: 'Bearer jwt.abc.def' }));

    await expect(rejection(result)).resolves.toEqual({
      status: 429,
      body: { error: 'Too many image-analysis requests. Please wait a moment and try again.' },
      retryAfter: '37',
    });
    expect(vi.mocked(consumeRateLimit)).toHaveBeenCalledWith('ai-analyze:user-9', {
      limit: 10,
      windowMs: 60_000,
    });
  });
});
