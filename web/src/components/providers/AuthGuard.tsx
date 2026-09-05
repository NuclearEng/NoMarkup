'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useEffect } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/auth-store';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Dashboard-shell skeleton while AuthRestorer hydrates the session.
 *
 * Replaces the centered spinner so initial paint mirrors the real layout
 * (heading + stat cards). LCP stays a large text/skeleton region instead of
 * a 32×32 spinner that only paints after JWT + first queries.
 */
function Loader() {
  return (
    <div
      className="dark flex min-h-screen flex-col bg-background px-4 py-10 sm:px-6"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="space-y-2">
          <p className="gold-text text-2xl font-bold tracking-tight sm:text-3xl">
            Loading your dashboard…
          </p>
          <p className="text-sm text-zinc-400">Restoring your session.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={`auth-skel-stat-${String(i)}`}
              className="h-28 rounded-xl"
              aria-hidden="true"
            />
          ))}
        </div>

        <div className="space-y-3">
          <Skeleton className="h-6 w-40" aria-hidden="true" />
          <Skeleton className="h-40 w-full rounded-xl" aria-hidden="true" />
          <Skeleton className="h-40 w-full rounded-xl" aria-hidden="true" />
        </div>
      </div>
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
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrating = useAuthStore((s) => s.isHydrating);

  useEffect(() => {
    if (isHydrating) return;
    if (!isAuthenticated) {
      const next = pathname && pathname.startsWith('/') ? pathname : '/dashboard';
      router.replace(`/login?next=${encodeURIComponent(next)}` as Route);
    }
  }, [isHydrating, isAuthenticated, router, pathname]);

  if (isHydrating || !isAuthenticated) {
    return <Loader />;
  }

  return <>{children}</>;
}
