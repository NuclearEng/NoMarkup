'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuthStore } from '@/stores/auth-store';

interface AuthGuardProps {
  children: React.ReactNode;
}

function hasSessionCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return /(?:^|; )has_session=1(?:;|$)/.test(document.cookie);
}

function Loader() {
  return (
    <div className="dark flex min-h-screen items-center justify-center bg-[#070b14]">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--brand-gold)]/30 border-t-[var(--brand-gold)]" />
    </div>
  );
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const { isAuthenticated, refreshToken } = useAuthStore();
  const [checking, setChecking] = useState(!isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      setChecking(false);
      return;
    }

    // No server-set session sentinel — skip the guaranteed-to-fail refresh
    // call and redirect straight to /login.
    if (!hasSessionCookie()) {
      router.replace('/login');
      setChecking(false);
      return;
    }

    // Sentinel present: try to restore session from the refresh token cookie.
    void refreshToken().then((success) => {
      if (!success) {
        router.replace('/login');
      }
      setChecking(false);
    });
  }, [isAuthenticated, refreshToken, router]);

  if (checking || !isAuthenticated) {
    return <Loader />;
  }

  return <>{children}</>;
}
