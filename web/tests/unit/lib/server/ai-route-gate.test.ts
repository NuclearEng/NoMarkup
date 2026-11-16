// ai-route-gate — auth + per-user rate limit for the paid-LLM proxy routes.
// Pins the token source (Bearer header ONLY: the legacy JS-readable
// oauth_access_token cookie is no longer issued or accepted, and a
// session-indicator cookie never was), fail-closed 401s, the shared
// (cross-replica) rate-limit key and budget, and the 429 + Retry-After response.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gateAiRoute, type AiRouteGateResult } from '@/lib/server/ai-route-gate';
import { consumeSharedRateLimit } from '@/lib/server/rate-limit-shared';
import { verifyAccessToken } from '@/lib/server/verify-jwt';

vi.mock('@/lib/server/rate-limit-shared', () => ({
  consumeSharedRateLimit: vi.fn(),
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
    vi.mocked(consumeSharedRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  });

  it.each<[string, string]>([
    ['a standard Bearer header', 'Bearer jwt.abc.def'],
    ['a lower-case scheme', 'bearer jwt.abc.def'],
    ['extra whitespace around the header', '  Bearer   jwt.abc.def  '],
  ])('verifies the token from %s and returns the subject', async (_label, authorization) => {
    const result = await gateAiRoute(requestWith({ authorization }));

    expect(result).toEqual({ ok: true, userId: 'user-1' });
    expect(vi.mocked(verifyAccessToken)).toHaveBeenCalledWith('jwt.abc.def');
  });

  it('rate-limits per user at 10 requests a minute', async () => {
    await gateAiRoute(requestWith({ authorization: 'Bearer jwt.abc.def' }));

    expect(vi.mocked(consumeSharedRateLimit).mock.calls).toEqual([
      ['ai-analyze:user-1', { limit: 10, windowMs: 60_000 }],
    ]);
  });

  it('uses the Bearer header and ignores an oauth cookie sent alongside it', async () => {
    await gateAiRoute(
      requestWith({ authorization: 'Bearer header.jwt', cookie: 'oauth_access_token=cookie.jwt' }),
    );

    expect(vi.mocked(verifyAccessToken).mock.calls).toEqual([['header.jwt']]);
  });

  it.each<[string, Record<string, string>]>([
    ['no credentials at all', {}],
    ['only session-indicator cookies', { cookie: 'has_session=1; refresh_token=opaque' }],
    ['a bare "Bearer" with no token', { authorization: 'Bearer' }],
    ['a non-Bearer scheme and no cookie', { authorization: 'Token abc' }],
    ['an empty oauth cookie', { cookie: 'oauth_access_token=' }],
    ['only the legacy oauth_access_token cookie', { cookie: 'oauth_access_token=cookie.jwt' }],
    [
      'a non-Bearer Authorization header beside the legacy oauth cookie',
      { authorization: 'Basic dXNlcjpwYXNz', cookie: 'oauth_access_token=cookie.jwt' },
    ],
    [
      'a Bearer header carrying more than one token beside the legacy oauth cookie',
      { authorization: 'Bearer a b', cookie: 'oauth_access_token=cookie.jwt' },
    ],
  ])('rejects %s with 401 without verifying or consuming budget', async (_label, headers) => {
    const result = await gateAiRoute(requestWith(headers));

    await expect(rejection(result)).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized' },
      retryAfter: null,
    });
    expect(vi.mocked(verifyAccessToken)).not.toHaveBeenCalled();
    expect(vi.mocked(consumeSharedRateLimit)).not.toHaveBeenCalled();
  });

  it('rejects a token that fails verification with 401, hiding the reason, and spends no budget', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ ok: false, reason: 'token expired' });

    const result = await gateAiRoute(requestWith({ authorization: 'Bearer expired.jwt' }));

    await expect(rejection(result)).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized' },
      retryAfter: null,
    });
    expect(vi.mocked(consumeSharedRateLimit)).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After once the user is over budget', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue(claimsFor('user-9'));
    vi.mocked(consumeSharedRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 37 });

    const result = await gateAiRoute(requestWith({ authorization: 'Bearer jwt.abc.def' }));

    await expect(rejection(result)).resolves.toEqual({
      status: 429,
      body: { error: 'Too many image-analysis requests. Please wait a moment and try again.' },
      retryAfter: '37',
    });
    expect(vi.mocked(consumeSharedRateLimit)).toHaveBeenCalledWith('ai-analyze:user-9', {
      limit: 10,
      windowMs: 60_000,
    });
  });
});
