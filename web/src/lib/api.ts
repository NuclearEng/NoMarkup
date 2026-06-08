import { getAccessToken, setAccessToken, clearTokens } from '@/lib/auth';
import { API_BASE_URL } from '@/lib/constants';
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
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.userMessage(fallback);
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  // Deduplicate concurrent refresh attempts
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  const token = getAccessToken();
  if (token && !skipAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
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
        ...extraHeaders,
      };
      const newToken = getAccessToken();
      if (newToken) {
        retryHeaders['Authorization'] = `Bearer ${newToken}`;
      }

      response = await fetch(`${API_BASE_URL}${path}`, {
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
 * Fresh Idempotency-Key header for payment/subscription mutations. The gateway
 * requires this header on all POSTs under the payment + subscription route
 * groups (middleware.RequireIdempotencyKey) and 400s without it. A per-call
 * UUID matches the gateway's "dedupe identical retries" contract.
 */
export function idempotencyHeader(): Record<string, string> {
  const key =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  return { 'Idempotency-Key': key };
}

// downloadAuthenticated fetches a protected file endpoint with the current
// bearer token and triggers a browser download. Required because a plain
// <a href> can't attach the Authorization header — the gateway middleware
// returns 401, leaving the user with a blank page / "nothing happened."
export async function downloadAuthenticated(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers,
    credentials: 'include',
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
