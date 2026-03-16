'use client';

import { useEffect, useRef } from 'react';

import { useAuthStore } from '@/stores/auth-store';

/**
 * Silently attempts to restore authentication state from a refresh token cookie.
 *
 * Unlike AuthGuard, this component never redirects unauthenticated users.
 * It is meant to be placed in the root layout so that auth state persists
 * across full-page navigations to public pages (where AuthGuard is absent).
 *
 * If the refresh succeeds the Zustand store is hydrated and components
 * like Header will render the authenticated UI.  If it fails, nothing
 * happens — the user simply stays unauthenticated.
 */
export function AuthRestorer() {
  const { isAuthenticated, refreshToken } = useAuthStore();
  const attempted = useRef(false);

  useEffect(() => {
    if (isAuthenticated || attempted.current) return;
    attempted.current = true;

    // Fire-and-forget — we intentionally ignore failures.
    void refreshToken();
  }, [isAuthenticated, refreshToken]);

  return null;
}
