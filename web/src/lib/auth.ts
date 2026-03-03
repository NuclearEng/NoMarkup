// In-memory access token storage (never persisted to localStorage)
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearTokens(): void {
  accessToken = null;
}

export function isAuthenticated(): boolean {
  return accessToken !== null;
}

interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  exp: number;
  iat: number;
}

/**
 * Decode a JWT payload without signature verification.
 * Used only for client-side display (role checks, user info).
 * The server is the authority for actual authorization.
 */
export function parseJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  const payload = parts[1];
  if (!payload) return null;

  try {
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}
