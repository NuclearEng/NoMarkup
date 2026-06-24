export const APP_NAME = 'NoMarkup' as const;

// API_BASE_URL is used primarily to derive WebSocket endpoints.
// HTTP API calls in the client now use relative paths (/api/v1/...) so they are
// routed through Next.js rewrites. This guarantees same-origin requests in dev
// (cookies just work, no CORS preflight for data fetches).
export const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? '';

/**
 * Resolve the WebSocket base URL for client connections.
 *
 * We prefer the current browser origin (so WS goes to :3000 and is handled by
 * Next dev server rewrites for `/ws/*`) unless the user has set an explicit
 * NEXT_PUBLIC_WS_URL for a real separate backend.
 *
 * This avoids the "direct to 8081" connections that cause CORS-like issues,
 * token-in-URL visibility in logs, and "WebSocket closed due to suspension"
 * during HMR / Fast Refresh / tab suspend cycles.
 */
export function resolveWsBase(): string {
  const explicit = (process.env['NEXT_PUBLIC_WS_URL'] || '').trim();
  if (explicit) {
    return explicit;
  }

  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }

  // Fallback (non-browser, e.g. SSR — shouldn't happen for WS)
  if (API_BASE_URL && API_BASE_URL.length > 0) {
    return API_BASE_URL.replace(/^http/, 'ws');
  }

  return '';
}

export const AUCTION_DURATION_OPTIONS = [24, 48, 72] as const;
export const MAX_BID_PHOTOS = 10;
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

export const REVIEW_MIN_COMMENT_LENGTH = 50;
export const REVIEW_WINDOW_DAYS = 14;
export const REVISION_MIN_NOTES_LENGTH = 200;

export const MIN_TOUCH_TARGET_PX = 44; // WCAG 2.2 AA

// Deprecated: use useFeatureFlag('live_auction') from @/hooks/useFeatureFlags instead.
// This env-based flag is kept for backward compatibility during migration.
export const ENABLE_LIVE_AUCTION = process.env['NEXT_PUBLIC_ENABLE_LIVE_AUCTION'] === 'true';
