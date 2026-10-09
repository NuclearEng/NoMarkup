'use client';

import { Briefcase, CreditCard, Gavel, Home, Menu, MessageSquare, X, Zap } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { activeNavHref, useNavItems } from '@/components/layout/SidebarNav';
import { useUnreadCount as useChatUnreadCount } from '@/hooks/useChannels';
import type { NavItem } from '@/components/layout/SidebarNav';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

/**
 * Four primary destinations in the mobile bottom tab bar (plus "More").
 *
 * Dual-role users (customer + provider) keep the **customer** primary tabs so
 * Jobs is never replaced by Bids. Provider-only users get Bids. Provider tools
 * remain reachable via the More drawer for dual-role accounts.
 */
function getPrimaryTabItems(opts: { isProvider: boolean; isCustomer: boolean }): NavItem[] {
  // Provider-primary only when the user has no customer role.
  if (opts.isProvider && !opts.isCustomer) {
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

/**
 * The single mobile navigation system: a thumb-reachable bottom tab bar with
 * four primary destinations plus a "More" drawer for the full nav list. Rendered
 * by BOTH the dashboard and public layouts so authenticated users get the same
 * bottom nav everywhere (one source of truth — the header no longer carries a
 * mobile nav grid). Renders nothing for logged-out visitors and during the
 * auth-restore hydrate window, so the public/logged-out experience is untouched.
 *
 * It also emits an in-flow spacer (same height as the fixed bar) so each layout
 * gets correct bottom padding automatically without coordinating its own inset.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const user = useAuthStore((s) => s.user);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const isCustomer = user?.roles.includes(USER_ROLE.CUSTOMER) ?? false;
  const allNavItems = useNavItems();
  const { data: chatUnread } = useChatUnreadCount();
  const messagesUnread = chatUnread?.total_unread ?? 0;

  const [moreOpen, setMoreOpen] = useState(false);
  // Focus management for the hand-rolled "More" drawer: close on Escape and move
  // focus into the drawer on open so keyboard users aren't stranded (WCAG 2.4.3).
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

  if (isHydrating || !isAuthenticated) return null;

  const primaryTabItems = getPrimaryTabItems({ isProvider, isCustomer });
  const activeSidebarHref = activeNavHref(
    pathname,
    allNavItems.map((i) => i.href),
  );
  const activeTabHref = activeNavHref(
    pathname,
    primaryTabItems.map((i) => i.href),
  );

  return (
    <>
      {/* In-flow spacer so page content clears the fixed bar on mobile. */}
      <div
        className="lg:hidden"
        style={{ height: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}
        aria-hidden="true"
      />

      <nav
        className="glass-nav fixed bottom-0 left-0 right-0 z-50 flex items-stretch border-t border-border lg:hidden"
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
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[0.625rem] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gold/60',
                active ? 'text-brand-gold' : 'text-muted-foreground active:text-foreground',
              )}
              aria-current={active ? 'page' : undefined}
              aria-label={
                item.href === '/messages' && messagesUnread > 0
                  ? `Messages, ${String(messagesUnread)} unread`
                  : undefined
              }
            >
              <span className="relative">
                <item.icon
                  className={cn(
                    'h-5 w-5 transition-transform duration-150',
                    active ? 'text-brand-gold scale-110' : 'text-muted-foreground',
                  )}
                  aria-hidden="true"
                />
                {item.href === '/messages' && messagesUnread > 0 ? (
                  <span
                    className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-gold px-1 text-[0.55rem] font-bold tabular-nums text-background"
                    aria-hidden="true"
                  >
                    {messagesUnread > 99 ? '99+' : String(messagesUnread)}
                  </span>
                ) : null}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}

        <button
          ref={moreTriggerRef}
          type="button"
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[0.625rem] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gold/60',
            moreOpen ? 'text-brand-gold' : 'text-muted-foreground active:text-foreground',
          )}
          onClick={() => { setMoreOpen(true); }}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          aria-label="More navigation options"
        >
          <Menu
            className={cn('h-5 w-5', moreOpen ? 'text-brand-gold' : 'text-muted-foreground')}
            aria-hidden="true"
          />
          <span>More</span>
        </button>
      </nav>

      {moreOpen ? (
        <>
          <div
            className="fixed inset-0 z-[60] bg-background/80 lg:hidden"
            aria-hidden="true"
            onClick={() => {
              setMoreOpen(false);
              moreTriggerRef.current?.focus();
            }}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-[70] animate-fade-in rounded-t-2xl border-t border-border bg-card px-4 pt-4 lg:hidden"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            role="dialog"
            aria-label="More navigation"
            aria-modal="true"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">All Pages</span>
              <button
                ref={moreCloseRef}
                type="button"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold/60"
                onClick={() => {
                  setMoreOpen(false);
                  moreTriggerRef.current?.focus();
                }}
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid max-h-[60dvh] grid-cols-3 gap-2 overflow-y-auto">
              {allNavItems.map((item) => {
                const active = item.href === activeSidebarHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl p-2 text-[0.65rem] font-medium leading-tight transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold/60',
                      active
                        ? 'bg-brand-gold/10 text-brand-gold'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
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
                className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl bg-brand-gold/10 p-2 text-[0.65rem] font-semibold leading-tight text-brand-gold transition-colors hover:bg-brand-gold/20 hover:text-brand-gold-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold/60"
                onClick={() => { setMoreOpen(false); }}
              >
                <Zap className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="text-center">Live Demo</span>
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
