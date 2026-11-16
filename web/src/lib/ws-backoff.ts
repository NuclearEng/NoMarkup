/**
 * Shared reconnect backoff for the four WebSocket clients (chat, auction,
 * spectator, marketplace spectator).
 *
 * Two problems this exists to solve, both observed in the production-readiness
 * review:
 *
 * 1. **No jitter anywhere.** Every client used a bare
 *    `Math.min(1000 * 2 ** attempt, 30_000)`. After a rolling deploy drops
 *    every socket at once, all clients wake on the same schedule and reconnect
 *    in lockstep waves — the classic thundering herd, aimed at a backend that
 *    is still starting up.
 *
 * 2. **Backoff reset on `onopen` produced a hot loop.** The gateway accepts
 *    the browser's WebSocket upgrade *before* dialing the chat backend, so
 *    during a backend outage the browser sees `onopen` and then an immediate
 *    close. Since every client reset its backoff inside `onopen`, the delay
 *    never grew past the first step and clients re-dialed roughly once a
 *    second, forever. The chat client also calls `attemptRefresh()` on each
 *    retry, so a chat outage turned into ~2 gateway requests per second per
 *    open tab — a self-inflicted load spike exactly when the backend is
 *    already unhealthy.
 *
 * The fix for (2) is to treat a connection as "real" only once it has stayed
 * open for a minimum duration. An open that closes immediately is a failed
 * attempt and must keep escalating.
 */

/** First retry delay, before jitter. */
export const INITIAL_RECONNECT_DELAY_MS = 1_000;

/** Ceiling on the retry delay, before jitter. */
export const MAX_RECONNECT_DELAY_MS = 30_000;

/** Exponential growth factor per failed attempt. */
export const RECONNECT_BACKOFF_MULTIPLIER = 2;

/**
 * How long a socket must stay open before we treat the connection as healthy
 * and reset the backoff.
 *
 * Sized to comfortably exceed a gateway accept-then-fail cycle (which closes
 * in tens of milliseconds) while staying short enough that a genuinely healthy
 * reconnect resets promptly.
 */
export const STABLE_CONNECTION_MS = 5_000;

/**
 * Apply full jitter to a computed delay: a uniformly random value in
 * `[delay/2, delay)`.
 *
 * Half-range rather than `[0, delay)` so a long backoff cannot collapse back
 * to near-zero and defeat the escalation, while still spreading a herd across
 * a wide enough window to matter.
 */
export function jitter(delayMs: number): number {
  const half = delayMs / 2;
  return Math.round(half + Math.random() * half);
}

/**
 * Delay before retry number `attempt` (0-based), with jitter applied.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number = INITIAL_RECONNECT_DELAY_MS,
  maxMs: number = MAX_RECONNECT_DELAY_MS,
): number {
  const raw = Math.min(baseMs * RECONNECT_BACKOFF_MULTIPLIER ** attempt, maxMs);
  return jitter(raw);
}

/**
 * Tracks whether a socket stayed open long enough to count as healthy.
 *
 * Usage: call `opened()` in `onopen`, and `closed()` in `onclose` — `closed()`
 * returns true when the connection lasted at least `STABLE_CONNECTION_MS`,
 * which is the signal to reset the backoff. Resetting in `onopen` instead is
 * what produced the hot loop described above.
 */
export class ConnectionStability {
  private openedAt: number | null = null;

  constructor(private readonly stableAfterMs: number = STABLE_CONNECTION_MS) {}

  opened(): void {
    this.openedAt = Date.now();
  }

  /** True when the connection that just closed had been stably open. */
  closed(): boolean {
    if (this.openedAt === null) return false;
    const lasted = Date.now() - this.openedAt;
    this.openedAt = null;
    return lasted >= this.stableAfterMs;
  }

  /** True if the socket is currently open and has already been stable. */
  isStable(): boolean {
    return this.openedAt !== null && Date.now() - this.openedAt >= this.stableAfterMs;
  }

  reset(): void {
    this.openedAt = null;
  }
}
