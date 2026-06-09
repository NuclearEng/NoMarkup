'use client';

import {
  Briefcase,
  CreditCard,
  Gavel,
  Home,
  MailWarning,
  Menu,
  MessageSquare,
  X,
  Zap,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Header } from '@/components/layout/Header';
import { activeNavHref, SidebarNav, useNavItems } from '@/components/layout/SidebarNav';
import type { NavItem } from '@/components/layout/SidebarNav';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { WebSocketProvider } from '@/components/providers/WebSocketProvider';
import { useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

function EmailVerificationBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const { data: profile } = useProfile();

  if (dismissed || !profile || profile.emailVerified) return null;

  async function handleResend() {
    if (!profile) return;
    setResending(true);
    try {
      await api.post('/api/v1/auth/resend-verification', { email: profile.email });
      setResent(true);
    } catch {
      // silently ignore — the email may already be sent
    } finally {
      setResending(false);
    }
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-2.5"
    >
      <MailWarning className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
      <p className="flex-1 text-sm text-amber-200">
        {resent
          ? 'Verification email sent! Check your inbox.'
          : 'Verify your email address to unlock all features.'}
      </p>
      {!resent ? (
        <button
          onClick={() => { void handleResend(); }}
          disabled={resending}
          className="shrink-0 text-xs font-medium text-amber-400 underline-offset-2 hover:underline disabled:opacity-50"
        >
          {resending ? 'Sending…' : 'Resend email'}
        </button>
      ) : null}
      <button
        onClick={() => { setDismissed(true); }}
        aria-label="Dismiss verification notice"
        className="shrink-0 rounded p-0.5 text-amber-400/60 hover:text-amber-400"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Four primary destinations shown in the mobile bottom tab bar (plus "More"). */
function getPrimaryTabItems(isProvider: boolean): NavItem[] {
  if (isProvider) {
    return [
      { href: '/dashboard' as Route, label: 'Home', icon: Home },
      { href: '/bids' as Route, label: 'Bids', icon: Gavel },
      { href: '/messages' as Route, label: 'Messages', icon: MessageSquare },
      { href: '/payments' as Route, label: 'Payments', icon: CreditCard },
    ];
  }
  return [
    { href: '/dashboard' as Route, label: 'Home', icon: Home },
    { href: '/jobs/mine' as Route, label: 'Jobs', icon: Briefcase },
    { href: '/messages' as Route, label: 'Messages', icon: MessageSquare },
    { href: '/payments' as Route, label: 'Payments', icon: CreditCard },
  ];
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const [moreOpen, setMoreOpen] = useState(false);
  // Focus management for the hand-rolled (non-Radix) "More" drawer: close on
  // Escape and move focus into the drawer on open so keyboard users aren't
  // stranded behind the modal (WCAG 2.1.1 / 2.4.3).
  const moreCloseRef = useRef<HTMLButtonElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    moreCloseRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  // Full nav list (role + feature-flag aware) — shared with the desktop
  // sidebar via the extracted SidebarNav component so the "More" drawer below
  // never drifts from the sidebar.
  const allNavItems = useNavItems();

  const primaryTabItems = getPrimaryTabItems(isProvider);

  // Resolve the active item once per nav list (most-specific match wins).
  const activeSidebarHref = activeNavHref(pathname, allNavItems.map((i) => i.href));
  const activeTabHref = activeNavHref(pathname, primaryTabItems.map((i) => i.href));

  return (
    <AuthGuard>
      <div className="flex min-h-screen flex-col bg-[#070b14]">
        <Header />
        <EmailVerificationBanner />

        <div className="flex flex-1">
          {/* Desktop sidebar — hidden on mobile. Shared with the marketplace. */}
          <SidebarNav />

          <WebSocketProvider>
            {/* Main content — mobile padding clears the fixed bottom tab bar */}
            <div className="dashboard-ambient min-w-0 flex-1 px-3 pt-3 sm:px-4 sm:pt-4 md:px-6 md:pt-6 mobile-bottom-inset">
              {children}
            </div>
          </WebSocketProvider>
        </div>

        {/* ─── Mobile bottom tab bar ─── */}
        <nav
          className="glass-nav fixed bottom-0 left-0 right-0 z-50 flex items-stretch border-t border-white/10 lg:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          aria-label="Main navigation"
        >
          {primaryTabItems.map((item) => {
            const active = item.href === activeTabHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[0.625rem] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-gold)]/60',
                  active ? 'text-[var(--brand-gold)]' : 'text-zinc-400 active:text-zinc-200',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon
                  className={cn(
                    'h-5 w-5 transition-transform duration-150',
                    active ? 'text-[var(--brand-gold)] scale-110' : 'text-zinc-400',
                  )}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            ref={moreTriggerRef}
            type="button"
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[0.625rem] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-gold)]/60',
              moreOpen ? 'text-[var(--brand-gold)]' : 'text-zinc-400 active:text-zinc-200',
            )}
            onClick={() => { setMoreOpen(true); }}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            aria-label="More navigation options"
          >
            <Menu
              className={cn('h-5 w-5', moreOpen ? 'text-[var(--brand-gold)]' : 'text-zinc-400')}
              aria-hidden="true"
            />
            <span>More</span>
          </button>
        </nav>

        {/* ─── More drawer (mobile only) ─── */}
        {moreOpen ? (
          <>
            <div
              className="fixed inset-0 z-[60] bg-black/60 lg:hidden"
              aria-hidden="true"
              onClick={() => {
                setMoreOpen(false);
                moreTriggerRef.current?.focus();
              }}
            />
            <div
              className="fixed bottom-0 left-0 right-0 z-[70] animate-fade-in rounded-t-2xl border-t border-white/10 bg-[#0c0f18] px-4 pt-4 lg:hidden"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
              role="dialog"
              aria-label="More navigation"
              aria-modal="true"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-100">All Pages</span>
                <button
                  ref={moreCloseRef}
                  type="button"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/60"
                  onClick={() => {
                    setMoreOpen(false);
                    moreTriggerRef.current?.focus();
                  }}
                  aria-label="Close navigation menu"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {allNavItems.map((item) => {
                  const active = item.href === activeSidebarHref;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl p-2 text-[0.65rem] font-medium leading-tight transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/60',
                        active
                          ? 'bg-[var(--brand-gold)]/10 text-[var(--brand-gold)]'
                          : 'bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-zinc-100',
                      )}
                      onClick={() => { setMoreOpen(false); }}
                      aria-current={active ? 'page' : undefined}
                    >
                      <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                      <span className="text-center">{item.label}</span>
                    </Link>
                  );
                })}

                <Link
                  href={'/demo/auction' as Route}
                  className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl bg-amber-500/10 p-2 text-[0.65rem] font-semibold leading-tight text-amber-400 transition-colors hover:bg-amber-500/20 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                  onClick={() => { setMoreOpen(false); }}
                >
                  <Zap className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="text-center">Live Demo</span>
                </Link>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </AuthGuard>
  );
}
