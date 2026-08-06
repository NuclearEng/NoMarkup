import { getAccessToken, setAccessToken, clearTokens } from '@/lib/auth';
import {
  attachTraceToSentry,
  withClientApiSpan,
} from '@/lib/otel/sentry-bridge';
import {
  HEADER_REQUEST_ID,
  HEADER_TRACEPARENT,
  buildOutboundTraceHeaders,
} from '@/lib/otel/trace-context';
import type { TokenPair } from '@/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API error ${String(status)}: ${body}`);
    this.name = 'ApiError';
  }

  // userMessage returns a human-readable error suitable for a toast. Gateway
  // errors are JSON of the form {"error": "..."} — extract the inner string
  // so users see the real reason ("contract is not active") instead of a raw
  // JSON blob or the generic "failed" placeholder.
  userMessage(fallback: string): string {
    try {
      const parsed = JSON.parse(this.body) as { error?: string; message?: string };
      if (parsed.error) return parsed.error;
      if (parsed.message) return parsed.message;
    } catch {
      // not JSON
    }
    if (this.body && this.body.length < 200) return this.body;
    return fallback;
  }
}

/**
 * getApiErrorMessage extracts a human-readable, user-facing message from any
 * thrown value. Use this in catch blocks / mutation onError handlers instead of
 * a hard-coded generic string so users see the server's actual reason
 * (gateway errors are JSON of the form {"error": "..."}).
 *
 *   catch (err) {
 *     toast.error(getApiErrorMessage(err, 'Could not place bid'));
 *   }
 *
 * - ApiError → delegates to .userMessage() (parses {error}/{message} JSON).
 * - Error    → returns .message.
 * - anything → returns the fallback.
 */
/**
 * Rewrite legacy server strings that leak integer cents ("bid must be at least
 * 17200 cents") into dollar amounts. Prefer fixing the gateway; this is a
 * last-line safety net so toasts never show raw cents.
 */
function humanizeMoneyMessage(msg: string): string {
  return msg.replace(/\b(\d+)\s*cents\b/gi, (_match, raw: string) => {
    const cents = Number(raw);
    if (!Number.isFinite(cents)) return _match;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  });
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return humanizeMoneyMessage(err.userMessage(fallback));
  if (err instanceof Error && err.message) return humanizeMoneyMessage(err.message);
  return fallback;
}

let refreshPromise: Promise<boolean> | null = null;

/**
 * attemptRefresh exchanges the HTTP-only refresh cookie for a fresh access
 * token and stores it via setAccessToken. Concurrent callers share one
 * in-flight request (deduped). Exported so the WebSocket layers can refresh
 * an expired access token before re-dialing — otherwise an idle socket whose
 * 15-min token expired would reconnect with the same dead token and loop on
 * 401 until an unrelated HTTP call happened to refresh it.
 */
export async function attemptRefresh(): Promise<boolean> {
  // Deduplicate concurrent refresh attempts
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      // Always use a relative URL for the refresh so that it goes through the
      // Next.js rewrite proxy (same-origin). This avoids CORS and ensures the
      // httpOnly refresh cookie (and has_session sentinel) are associated with
      // the web origin.
      const traceHeaders = buildOutboundTraceHeaders();
      const response = await fetch(`/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...traceHeaders },
      });
      attachTraceToSentry({
        requestId: response.headers.get(HEADER_REQUEST_ID) ?? traceHeaders[HEADER_REQUEST_ID],
        traceparent: traceHeaders[HEADER_TRACEPARENT],
      });

      if (!response.ok) return false;

      const data = (await response.json()) as TokenPair;
      setAccessToken(data.access_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  skipAuth = false,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  // Mint once per logical attempt so the 401 retry reuses the same request id
  // (gateway logs stay joinable across the refresh hop).
  const traceHeaders = buildOutboundTraceHeaders();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...traceHeaders,
    ...extraHeaders,
  };

  const token = getAccessToken();
  if (token && !skipAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return withClientApiSpan(
    {
      method,
      path,
      requestId: traceHeaders[HEADER_REQUEST_ID],
      traceparent: traceHeaders[HEADER_TRACEPARENT],
    },
    async () => {
      let response: Response;
      try {
        // Use the caller-supplied path (always starts with /api/v1...) directly.
        // This goes through Next rewrites when API_BASE_URL would point elsewhere,
        // giving us same-origin semantics, working cookies, and no CORS preflight
        // for the main data surface.
        response = await fetch(path, {
          method,
          headers,
          credentials: 'include',
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new ApiError(503, 'Unable to reach the server. Please try again shortly.');
      }

      // On 401, attempt token refresh and retry once
      if (response.status === 401 && !skipAuth) {
        const refreshed = await attemptRefresh();
        if (refreshed) {
          const retryHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            // Same correlation headers — this is the same logical attempt.
            ...traceHeaders,
            ...extraHeaders,
          };
          const newToken = getAccessToken();
          if (newToken) {
            retryHeaders['Authorization'] = `Bearer ${newToken}`;
          }

          response = await fetch(path, {
            method,
            headers: retryHeaders,
            credentials: 'include',
            body: body ? JSON.stringify(body) : undefined,
          });
        } else {
          clearTokens();
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
          throw new ApiError(401, 'Session expired');
        }
      }

      // Prefer the gateway-echoed id (authoritative) for Sentry tags.
      attachTraceToSentry({
        requestId:
          response.headers.get(HEADER_REQUEST_ID) ?? traceHeaders[HEADER_REQUEST_ID],
        traceparent: traceHeaders[HEADER_TRACEPARENT],
      });

      if (!response.ok) {
        throw new ApiError(response.status, await response.text());
      }

      // 204 No Content (and other empty-body successes, e.g. DELETE endpoints) have
      // no JSON to parse. Calling response.json() on an empty body throws a
      // SyntaxError — in WebKit/Safari the message is the cryptic "The string did
      // not match the expected pattern." — which surfaced as a false "delete
      // failed" toast even though the server succeeded. Return undefined instead.
      if (response.status === 204 || response.headers.get('Content-Length') === '0') {
        return undefined as T;
      }
      const text = await response.text();
      if (text === '') {
        return undefined as T;
      }
      return JSON.parse(text) as T;
    },
  );
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) =>
    request<T>('POST', path, body, false, extraHeaders),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  /** Post without attaching auth header (for login/register) */
  postUnauthed: <T>(path: string, body?: unknown) =>
    request<T>('POST', path, body, true),
  /** GET without auth header or 401 retry (for public endpoints like job search) */
  getPublic: <T>(path: string) => request<T>('GET', path, undefined, true),
};

/**
 * Mint a single Idempotency-Key UUID (not yet bound to an operation).
 */
function mintIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

/**
 * In-memory map of logical-operation id → Idempotency-Key. Retries of the SAME
 * operation (double-tap, network retry, React Query retry) must present the same
 * key or the gateway cannot dedupe and a second charge can land.
 *
 * Cleared via clearIdempotencyKey after a terminal success so a later intentional
 * re-attempt (e.g. pay again after refund) mints a new key.
 */
const idempotencyKeyByOperation = new Map<string, string>();

/**
 * Idempotency-Key header for payment/subscription mutations.
 *
 * The gateway requires this on all POSTs under payment + subscription route
 * groups (middleware.RequireIdempotencyKey) and 400s without it.
 *
 * Pass a stable `operationKey` derived from the logical mutation
 * (`order-pay:${orderId}`, `buy-now:${listingId}`, …). The same key is reused
 * for every call with that id until clearIdempotencyKey is invoked. Omitting
 * the argument still mints a fresh UUID (legacy callers) but that defeats
 * retry dedupe — prefer always passing an operation key on money paths.
 */
export function idempotencyHeader(operationKey?: string): Record<string, string> {
  let key: string;
  if (operationKey !== undefined && operationKey.length > 0) {
    const existing = idempotencyKeyByOperation.get(operationKey);
    if (existing !== undefined) {
      key = existing;
    } else {
      key = mintIdempotencyKey();
      idempotencyKeyByOperation.set(operationKey, key);
    }
  } else {
    key = mintIdempotencyKey();
  }
  return { 'Idempotency-Key': key };
}

/** Drop a stored key so the next call for this operation mints a fresh one. */
export function clearIdempotencyKey(operationKey: string): void {
  idempotencyKeyByOperation.delete(operationKey);
}

/** Test helper: wipe the in-memory map between cases. */
export function __resetIdempotencyKeysForTests(): void {
  idempotencyKeyByOperation.clear();
}

// downloadAuthenticated fetches a protected file endpoint with the current
// bearer token and triggers a browser download. Required because a plain
// <a href> can't attach the Authorization header — the gateway middleware
// returns 401, leaving the user with a blank page / "nothing happened."
export async function downloadAuthenticated(path: string, filename: string): Promise<void> {
  const traceHeaders = buildOutboundTraceHeaders();
  const fetchOnce = async (): Promise<Response> => {
    const headers: Record<string, string> = { ...traceHeaders };
    const token = getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    // Relative path for same-origin proxy benefits (cookies, no CORS).
    return fetch(path, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
  };

  let response = await fetchOnce();

  // Short-lived access tokens expire after 15 min; on 401 refresh once and
  // retry, mirroring request() above so a stale token doesn't surface as a
  // spurious download failure.
  if (response.status === 401) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      response = await fetchOnce();
    }
  }

  attachTraceToSentry({
    requestId: response.headers.get(HEADER_REQUEST_ID) ?? traceHeaders[HEADER_REQUEST_ID],
    traceparent: traceHeaders[HEADER_TRACEPARENT],
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
