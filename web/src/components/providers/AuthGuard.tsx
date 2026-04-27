'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuthStore } from '@/stores/auth-store';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Skeleton-style loader. Replaces the previous tiny spinner so that on
 * Slow-3G the LCP element is a real piece of the page layout (the gold
 * "Loading your dashboard…" heading), not the post-auth `<h1>` greeting.
 *
 * The earlier spinner-only loader was 32x32px in the center of the
 * viewport, so the LCP element was always a downstream paint that
 * couldn't happen until BOTH the JWT refresh round-trip and the first
 * batch of dashboard queries had resolved. This heading saturates LCP
 * within a few frames of the JS bundle parsing.
 */
function Loader() {
  return (
    <div
      className="dark flex min-h-screen flex-col items-center justify-center gap-4 bg-[#070b14] px-4"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--brand-gold)]/30 border-t-[var(--brand-gold)]" />
      <p className="gold-text text-2xl font-bold tracking-tight sm:text-3xl">
        Loading your dashboard…
      </p>
      <p className="text-sm text-zinc-400">Restoring your session.</p>
    </div>
  );
}

/**
 * AuthGuard waits for AuthRestorer (mounted at the root layout) to finish
 * the single shared refresh-token call, then either renders children or
 * redirects to /login. We deliberately avoid calling refreshToken() here
 * because refresh tokens are single-use — a second concurrent call would
 * race the restorer and 401.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrating = useAuthStore((s) => s.isHydrating);

  useEffect(() => {
    if (isHydrating) return;
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isHydrating, isAuthenticated, router]);

  if (isHydrating || !isAuthenticated) {
    return <Loader />;
  }

  return <>{children}</>;
}
