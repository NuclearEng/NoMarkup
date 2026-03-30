'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';

import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';

export function Header() {
  const router = useRouter();
  const { user, isAuthenticated, isHydrating, logout } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <header className="glass-nav sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Logo />

        {/* Desktop nav */}
        <nav className="hidden items-center gap-4 md:flex" aria-label="Main">
          <Link
            href="/demo/auction"
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/10 hover:text-amber-300"
          >
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            Live Demo
          </Link>
          {isHydrating ? null : isAuthenticated ? (
            <>
              <NotificationBell />
              <span className="text-muted-foreground text-sm">
                {user?.displayName ?? user?.email}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() => void handleLogout()}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="min-h-[44px]" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
              <Button size="sm" className="min-h-[44px]" asChild>
                <Link href="/register">Get started</Link>
              </Button>
            </>
          )}
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center md:hidden"
          onClick={() => {
            setMobileMenuOpen((prev) => !prev);
          }}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
          aria-label="Toggle navigation menu"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            {mobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <nav id="mobile-menu" className="glass-elevated border-t border-white/10 px-4 py-4 md:hidden" aria-label="Mobile">
          <div className="flex flex-col gap-3">
            <Link
              href="/demo/auction"
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/20 hover:text-amber-300"
            >
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              Live Demo
            </Link>
            {isHydrating ? null : isAuthenticated ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">
                    {user?.displayName ?? user?.email}
                  </span>
                  <NotificationBell />
                </div>
                <Button
                  variant="outline"
                  className="min-h-[44px] w-full"
                  onClick={() => void handleLogout()}
                >
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" className="min-h-[44px] w-full" asChild>
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button className="min-h-[44px] w-full" asChild>
                  <Link href="/register">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
