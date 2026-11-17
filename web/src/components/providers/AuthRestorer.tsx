'use client';

import { useEffect, useRef } from 'react';

import { looksLikeSessionFlag } from '@/lib/session-flag';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Silently attempts to restore authentication state.
 *
 * When the gateway's signed has_session flag is present (password login or
 * OAuth callback), it exchanges the HttpOnly refresh cookie for an in-memory
 * access token via POST /api/v1/auth/refresh. No credential is ever read
 * from a JS-visible cookie.
 *
 * Unlike AuthGuard, this component never redirects unauthenticated users.
 * It is meant to be placed in the root layout so that auth state persists
 * across full-page navigations to public pages (where AuthGuard is absent).
 */
export function AuthRestorer() {
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // Clear legacy JS-readable OAuth handoff cookies from older gateway
    // builds. The gateway no longer sends the access token to page scripts:
    // after OAuth it sets the HttpOnly refresh cookie + signed has_session,
    // and we exchange that for an access token via POST /api/v1/auth/refresh.
    deleteCookie('oauth_access_token');
    deleteCookie('oauth_token_expires');

    if (!looksLikeSessionFlag(getCookie('has_session'))) {
      // No server-set session sentinel — don't hit /auth/refresh and avoid a
      // guaranteed 400 in the console on every public page load. Client only
      // does a structural check (v1.* or legacy "1"); HMAC verify is edge-only.
      useAuthStore.setState({ isHydrating: false });
      return;
    }

    // Exchange the HttpOnly refresh cookie (POST) for an in-memory access token.
    void refreshToken();
  }, [refreshToken]);

  return null;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'),
  );
  const raw = match?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  const secure = location.protocol === 'https:' ? '; secure' : '';
  document.cookie = name + '=; path=/; max-age=0; samesite=strict' + secure;
}
