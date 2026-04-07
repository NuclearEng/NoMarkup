'use client';

import {
  Banknote,
  BarChart3,
  Briefcase,
  Building2,
  CreditCard,
  FileText,
  Gavel,
  Home,
  LayoutDashboard,
  MailWarning,
  Menu,
  MessageSquare,
  PlusCircle,
  Settings,
  Shield,
  Trophy,
  User,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { Header } from '@/components/layout/Header';
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
    setResending(true);
    try {
      await api.post('/api/v1/auth/verify-email/resend');
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

interface NavItem {
  href: Route;
  label: string;
  icon: typeof Home;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard' as Route, label: 'Dashboard', icon: Home },
  { href: '/profile' as Route, label: 'Profile', icon: User },
];

const PROVIDER_NAV_ITEMS: NavItem[] = [
  { href: '/provider' as Route, label: 'Provider Dashboard', icon: LayoutDashboard },
  { href: '/provider/workspace' as Route, label: 'Workspace', icon: Wrench },
  { href: '/bids' as Route, label: 'My Bids', icon: Gavel },
  { href: '/provider/team' as Route, label: 'Team', icon: Users },
  { href: '/provider/advances' as Route, label: 'Working Capital', icon: Banknote },
  { href: '/provider/business' as Route, label: 'Business Tools', icon: Building2 },
  { href: '/provider/challenges' as Route, label: 'Challenges', icon: Trophy },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: '/admin' as Route, label: 'Admin Panel', icon: Shield },
  { href: '/admin/users' as Route, label: 'Manage Users', icon: Users },
  { href: '/admin/disputes' as Route, label: 'Disputes', icon: BarChart3 },
];

const COMMON_NAV_ITEMS: NavItem[] = [
  { href: '/contracts' as Route, label: 'Contracts', icon: FileText },
  { href: '/payments' as Route, label: 'Payments', icon: CreditCard },
  { href: '/messages' as Route, label: 'Messages', icon: MessageSquare },
  { href: '/jobs/mine' as Route, label: 'My Jobs', icon: Briefcase },
  { href: '/jobs/new' as Route, label: 'Post Job', icon: PlusCircle },
  { href: '/settings/security' as Route, label: 'Settings', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (
    href === '/dashboard' ||
    href === '/bids' ||
    href === '/jobs/mine' ||
    href === '/jobs/new' ||
    href === '/provider/advances' ||
    href === '/provider/business' ||
    href === '/provider/team' ||
    href === '/provider/workspace'
  ) {
    return pathname === href || pathname.startsWith(href + '/');
  }
  return pathname.startsWith(href);
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
  const isAdmin = user?.roles.includes(USER_ROLE.ADMIN) ?? false;
  const [moreOpen, setMoreOpen] = useState(false);

  const allNavItems = [
    ...BASE_NAV_ITEMS,
    ...(isProvider ? PROVIDER_NAV_ITEMS : []),
    ...(isAdmin ? ADMIN_NAV_ITEMS : []),
    ...COMMON_NAV_ITEMS,
  ];

  const primaryTabItems = getPrimaryTabItems(isProvider);

  return (
    <AuthGuard>
      <div className="dark flex min-h-screen flex-col bg-[#070b14]">
        <Header />
        <EmailVerificationBanner />

        <div className="flex flex-1">
          {/* Desktop sidebar — hidden on mobile */}
          <aside className="glass-sidebar hidden w-64 lg:block">
            <nav className="space-y-1 p-4" aria-label="Dashboard navigation">
              {allNavItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex min-h-[44px] items-center gap-3 rounded-r-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                      active
                        ? 'rounded-l-none border-l-2 border-[var(--brand-gold)] bg-[var(--brand-gold)]/10 pl-[10px] text-[var(--brand-gold)] shadow-[inset_0_1px_0_rgba(201,168,76,0.1)]'
                        : 'rounded-lg text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/40',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <item.icon
                      className={cn('h-4 w-4', active ? 'text-[var(--brand-gold)]' : '')}
                      style={{ opacity: active ? 1 : 0.6 }}
                      aria-hidden="true"
                    />
                    {item.label}
                  </Link>
                );
              })}
              <div className="glass-divider my-2" aria-hidden="true" />
              <Link
                href={'/demo/auction' as Route}
                className="relative flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-amber-400 transition-all duration-200 hover:bg-amber-500/10 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
              >
                <Zap className="h-4 w-4" aria-hidden="true" />
                Live Demo
              </Link>
            </nav>
          </aside>

          <WebSocketProvider>
            {/* Main content — mobile padding clears the fixed bottom tab bar */}
            <div className="dashboard-ambient flex-1 px-3 pt-3 sm:px-4 sm:pt-4 md:px-6 md:pt-6 mobile-bottom-inset">
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
            const active = isActive(pathname, item.href);
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
              onClick={() => { setMoreOpen(false); }}
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
                  type="button"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/60"
                  onClick={() => { setMoreOpen(false); }}
                  aria-label="Close navigation menu"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {allNavItems.map((item) => {
                  const active = isActive(pathname, item.href);
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
