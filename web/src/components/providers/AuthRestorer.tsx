'use client';

import { useEffect, useRef } from 'react';

import { parseJwtPayload, setAccessToken } from '@/lib/auth';
import { looksLikeSessionFlag } from '@/lib/session-flag';
import { useAuthStore } from '@/stores/auth-store';
import type { UserRole } from '@/types';

/**
 * Silently attempts to restore authentication state.
 *
 * On mount it first checks for short-lived OAuth callback cookies (set by the
 * gateway when a user completes Google/Apple sign-in). If found, those are
 * consumed and the auth store is hydrated immediately.
 *
 * Otherwise it falls back to the normal refresh-token flow.
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

    // Check for OAuth callback cookies first.
    const oauthToken = getCookie('oauth_access_token');
    if (!oauthToken && !looksLikeSessionFlag(getCookie('has_session'))) {
      // No server-set session sentinel — don't hit /auth/refresh and avoid a
      // guaranteed 400 in the console on every public page load. Client only
      // does a structural check (v1.* or legacy "1"); HMAC verify is edge-only.
      useAuthStore.setState({ isHydrating: false });
      return;
    }

    if (oauthToken) {
      // Clear the short-lived cookies immediately.
      deleteCookie('oauth_access_token');
      deleteCookie('oauth_token_expires');

      const payload = parseJwtPayload(oauthToken);
      if (!payload) {
        // Malformed callback token must not leave AuthGuard on the hydrating
        // skeleton forever — isHydrating starts true in the store.
        useAuthStore.setState({ isHydrating: false });
        return;
      }

      setAccessToken(oauthToken);
      useAuthStore.setState({
        user: {
          id: payload.sub,
          email: payload.email,
          displayName: '',
          avatarUrl: null,
          roles: payload.roles as UserRole[],
          status: 'active',
          emailVerified: true,
          phoneVerified: false,
          mfaEnabled: false,
          createdAt: new Date().toISOString(),
        },
        accessToken: oauthToken,
        isAuthenticated: true,
        isHydrating: false,
      });
      return;
    }

    // No OAuth cookies — fall back to normal refresh.
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
