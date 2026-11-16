/**
 * In-memory sliding-window rate limiter for Next.js API routes.
 *
 * LIMITATION: state is per-process. With multiple Next replicas (or
 * serverless instances) the effective limit is N_replicas × limit, and a
 * process restart clears all windows. That is acceptable here — this guards
 * a paid-LLM cost-abuse vector, where "roughly 10/min/user" is the goal, not
 * an exact quota. If we ever scale web horizontally, move this to the
 * gateway's Redis-backed limiter.
 */

interface RateLimitOptions {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
}

// key → ascending request timestamps (ms) within the current window.
const windows = new Map<string, number[]>();

// Prune dead keys periodically so the Map doesn't grow unboundedly with
// one-off users. Piggybacks on request traffic — no timers to leak.
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
let lastPruneMs = 0;

function pruneStale(nowMs: number, windowMs: number): void {
  if (nowMs - lastPruneMs < PRUNE_INTERVAL_MS) return;
  lastPruneMs = nowMs;
  const cutoff = nowMs - windowMs;
  for (const [key, timestamps] of windows) {
    const last = timestamps[timestamps.length - 1];
    if (last === undefined || last <= cutoff) windows.delete(key);
  }
}

/**
 * Record an attempt for `key` and decide whether it is within the limit.
 * `nowMs` is injectable for tests.
 */
export function consumeRateLimit(
  key: string,
  options: RateLimitOptions,
  nowMs: number = Date.now(),
): RateLimitDecision {
  pruneStale(nowMs, options.windowMs);

  const cutoff = nowMs - options.windowMs;
  const recent = (windows.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= options.limit) {
    windows.set(key, recent);
    const oldest = recent[0] ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + options.windowMs - nowMs) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  recent.push(nowMs);
  windows.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Clear all rate-limit state. Intended for tests. */
export function resetRateLimit(): void {
  windows.clear();
  lastPruneMs = 0;
}
