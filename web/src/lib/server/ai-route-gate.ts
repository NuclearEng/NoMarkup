/**
 * Shared auth + rate-limit gate for the paid-LLM proxy routes
 * (/api/analyze-job-image, /api/analyze-listing-image).
 *
 * These routes spend real money per call (Anthropic API), so token PRESENCE
 * is not enough: the Bearer token is cryptographically verified (RS256
 * signature, exp, iss, aud — same checks as the Go gateway) and each user is
 * held to a small sliding-window budget keyed by the JWT `sub` claim.
 *
 * Token sources, in order:
 *   1. `Authorization: Bearer <jwt>` — the normal client path (access JWT
 *      lives in memory on the client, see web/src/lib/auth.ts).
 *   2. `oauth_access_token` cookie — the short-lived (60s) cookie the gateway
 *      sets right after an OAuth callback; it contains the same access JWT.
 *
 * Session-indicator cookies (`has_session`, `refresh_token`) are deliberately
 * NOT accepted here: they prove a session exists but are not verifiable by
 * the web tier, and this endpoint must fail closed.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { consumeRateLimit } from './rate-limit';
import { verifyAccessToken } from './verify-jwt';

// 10 requests per user per minute — generous for a human filling in a form,
// hostile to a cost-abuse loop.
const AI_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;

export type AiRouteGateResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

function extractToken(request: NextRequest): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1];
  }
  const oauthCookie = request.cookies.get('oauth_access_token')?.value;
  if (oauthCookie) return oauthCookie;
  return null;
}

/**
 * Verify the caller's access JWT and enforce the per-user rate limit.
 * Returns `{ ok: true, userId }` or a ready-to-return 401/429 response
 * matching the routes' existing `{ error: string }` shape.
 */
export function gateAiRoute(request: NextRequest): AiRouteGateResult {
  const token = extractToken(request);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }

  const verified = verifyAccessToken(token);
  if (!verified.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }

  const decision = consumeRateLimit(`ai-analyze:${verified.claims.sub}`, AI_RATE_LIMIT);
  if (!decision.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Too many image-analysis requests. Please wait a moment and try again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(decision.retryAfterSeconds) },
        },
      ),
    };
  }

  return { ok: true, userId: verified.claims.sub };
}
