'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuthStore } from '@/stores/auth-store';

interface AuthGuardProps {
  children: React.ReactNode;
}

function Loader() {
  return (
    <div className="dark flex min-h-screen items-center justify-center bg-[#070b14]">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--brand-gold)]/30 border-t-[var(--brand-gold)]" />
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
