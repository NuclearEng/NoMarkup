/**
 * Cross-replica rate limiter for Next.js API routes.
 *
 * Uses a Redis fixed-window counter over the Redis REST protocol (Upstash or
 * any compatible proxy, e.g. serverless-redis-http in front of the cluster's
 * Redis), so no native Redis client dependency is needed in the web bundle:
 *
 *   INCR key ; PEXPIRE key windowMs NX ; PTTL key
 *
 * Configure with server-only env vars (never NEXT_PUBLIC_):
 *   RATE_LIMIT_REDIS_REST_URL    e.g. https://<db>.upstash.io
 *   RATE_LIMIT_REDIS_REST_TOKEN  bearer token
 *
 * When unset, or if Redis errors/times out, it falls back to the in-memory
 * per-process limiter so the route keeps a (weaker) limit instead of failing
 * open or failing the user's request.
 */

import { consumeRateLimit, type RateLimitDecision } from './rate-limit';

export interface SharedRateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface SharedRateLimitDeps {
  fetchImpl?: typeof fetch;
  url?: string | undefined;
  token?: string | undefined;
  timeoutMs?: number;
  nowMs?: number;
  onFallback?: (reason: string) => void;
}

const KEY_PREFIX = 'nm:web:rl:';

interface PipelineEntry {
  result?: unknown;
  error?: string;
}

export async function consumeSharedRateLimit(
  key: string,
  options: SharedRateLimitOptions,
  deps: SharedRateLimitDeps = {},
): Promise<RateLimitDecision> {
  const url = (deps.url ?? process.env['RATE_LIMIT_REDIS_REST_URL'] ?? '').replace(/\/+$/, '');
  const token = deps.token ?? process.env['RATE_LIMIT_REDIS_REST_TOKEN'] ?? '';
  const fallback = (reason: string): RateLimitDecision => {
    deps.onFallback?.(reason);
    return consumeRateLimit(key, options, deps.nowMs);
  };

  if (!url || !token) return fallback('unconfigured');

  const fetchImpl = deps.fetchImpl ?? fetch;
  const redisKey = KEY_PREFIX + key;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, deps.timeoutMs ?? 300);
  try {
    const res = await fetchImpl(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['PEXPIRE', redisKey, String(options.windowMs), 'NX'],
        ['PTTL', redisKey],
      ]),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return fallback(`http_${String(res.status)}`);
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return fallback('bad_response');
    const entries = body as PipelineEntry[];
    const count = Number(entries[0]?.result);
    const pttl = Number(entries[2]?.result);
    if (entries.some((e) => e.error) || !Number.isFinite(count)) {
      return fallback('bad_response');
    }
    if (count > options.limit) {
      const ms = Number.isFinite(pttl) && pttl > 0 ? pttl : options.windowMs;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch {
    return fallback('error');
  } finally {
    clearTimeout(timer);
  }
}
