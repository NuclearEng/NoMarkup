/**
 * Shared auth + rate-limit gate for the paid-LLM proxy routes
 * (/api/analyze-job-image, /api/analyze-listing-image).
 *
 * These routes spend real money per call (Anthropic API), so token PRESENCE
 * is not enough: the Bearer token is cryptographically verified (RS256
 * signature, exp, iss, aud — same checks as the Go gateway) and each user is
 * held to a small sliding-window budget keyed by the JWT `sub` claim.
 *
 * Token source: `Authorization: Bearer <jwt>` only (access JWT lives in
 * memory on the client, see web/src/lib/auth.ts). The legacy JS-readable
 * `oauth_access_token` cookie is no longer issued or accepted.
 *
 * Rate limiting is shared across web replicas via Redis (REST) when
 * configured, falling back to the per-process limiter (see rate-limit-shared.ts).
 *
 * Session-indicator cookies (`has_session`, `refresh_token`) are deliberately
 * NOT accepted here: they prove a session exists but are not verifiable by
 * the web tier, and this endpoint must fail closed.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { consumeSharedRateLimit } from './rate-limit-shared';
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
  return null;
}

/**
 * Verify the caller's access JWT and enforce the per-user rate limit.
 * Returns `{ ok: true, userId }` or a ready-to-return 401/429 response
 * matching the routes' existing `{ error: string }` shape.
 */
export async function gateAiRoute(request: NextRequest): Promise<AiRouteGateResult> {
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

  const decision = await consumeSharedRateLimit(`ai-analyze:${verified.claims.sub}`, AI_RATE_LIMIT);
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
