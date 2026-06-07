'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';

import {
  Briefcase,
  Home,
  MapPin,
  MessageSquare,
  PlusCircle,
  Search,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';

export function Header() {
  const router = useRouter();
  const { user, isAuthenticated, isHydrating, logout } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <header className="glass-nav sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo links to dashboard when authenticated, landing page otherwise */}
        {isAuthenticated ? (
          <Link href={'/dashboard' as Route} className="inline-flex min-h-[44px] items-center text-foreground no-underline" aria-label="Go to Dashboard">
            <span className="font-[var(--font-brand),sans-serif] text-xl font-extrabold -tracking-[0.02em]">
              No<span className="gold-text">Markup</span>
            </span>
          </Link>
        ) : (
          <Logo />
        )}

        {/* Desktop nav */}
        <nav className="hidden items-center gap-4 md:flex" aria-label="Main">
          {isAuthenticated ? (
            <>
              <Link
                href={'/dashboard' as Route}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
              >
                <Home className="h-3.5 w-3.5" aria-hidden="true" />
                Dashboard
              </Link>
              <Link
                href={'/jobs' as Route}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                Browse Jobs
              </Link>
            </>
          ) : null}
          <Link
            href={'/marketplace/map' as Route}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            Map
          </Link>
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
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] md:hidden"
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
        <nav id="mobile-menu" className="glass-elevated animate-fade-in max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-none border-t border-white/10 px-4 py-4 md:hidden" aria-label="Mobile">
          <div className="flex flex-col gap-3">
            {isHydrating ? null : isAuthenticated ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">
                    {user?.displayName ?? user?.email}
                  </span>
                  <NotificationBell />
                </div>

                {/* Quick nav links */}
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href={'/dashboard' as Route}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08]"
                    onClick={() => { setMobileMenuOpen(false); }}
                  >
                    <Home className="h-4 w-4 text-[var(--brand-gold)]/60" aria-hidden="true" />
                    Dashboard
                  </Link>
                  <Link
                    href={'/jobs/mine' as Route}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08]"
                    onClick={() => { setMobileMenuOpen(false); }}
                  >
                    <Briefcase className="h-4 w-4 text-[var(--brand-gold)]/60" aria-hidden="true" />
                    My Jobs
                  </Link>
                  <Link
                    href={'/jobs' as Route}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08]"
                    onClick={() => { setMobileMenuOpen(false); }}
                  >
                    <Search className="h-4 w-4 text-[var(--brand-gold)]/60" aria-hidden="true" />
                    Browse Jobs
                  </Link>
                  <Link
                    href={'/messages' as Route}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08]"
                    onClick={() => { setMobileMenuOpen(false); }}
                  >
                    <MessageSquare className="h-4 w-4 text-[var(--brand-gold)]/60" aria-hidden="true" />
                    Messages
                  </Link>
                </div>

                <Link
                  href={'/jobs/new' as Route}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[var(--brand-gold)]/10 px-3 py-2 text-sm font-semibold text-[var(--brand-gold)] transition-colors hover:bg-[var(--brand-gold)]/20"
                  onClick={() => { setMobileMenuOpen(false); }}
                >
                  <PlusCircle className="h-4 w-4" aria-hidden="true" />
                  Post a Job
                </Link>

                {isProvider ? (
                  <Link
                    href={'/provider' as Route}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08]"
                    onClick={() => { setMobileMenuOpen(false); }}
                  >
                    Provider Dashboard
                  </Link>
                ) : null}

                <Link
                  href="/demo/auction"
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/20 hover:text-amber-300"
                  onClick={() => { setMobileMenuOpen(false); }}
                >
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  Live Demo
                </Link>

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
                <Link
                  href="/demo/auction"
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/20 hover:text-amber-300"
                  onClick={() => { setMobileMenuOpen(false); }}
                >
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  Live Demo
                </Link>
                <Button variant="outline" className="min-h-[44px] w-full" asChild>
                  <Link href="/login" onClick={() => { setMobileMenuOpen(false); }}>Sign in</Link>
                </Button>
                <Button className="min-h-[44px] w-full" asChild>
                  <Link href="/register" onClick={() => { setMobileMenuOpen(false); }}>Get started</Link>
                </Button>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
