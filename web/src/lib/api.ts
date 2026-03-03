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
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getAccessToken();
  if (token && !skipAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  // On 401, attempt token refresh and retry once
  if (response.status === 401 && !skipAuth) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      const retryHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
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

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  /** Post without attaching auth header (for login/register) */
  postUnauthed: <T>(path: string, body?: unknown) =>
    request<T>('POST', path, body, true),
};
