'use client';

import {
  Banknote,
  Bookmark,
  Briefcase,
  Building2,
  CreditCard,
  FileText,
  Gavel,
  Heart,
  Home,
  LayoutDashboard,
  MessageSquare,
  Package,
  PlusCircle,
  Rss,
  Scale,
  Search,
  Settings,
  Shield,
  Sparkles,
  Tag,
  Trophy,
  User,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

export interface NavItem {
  href: Route;
  label: string;
  icon: typeof Home;
}

export const BASE_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard' as Route, label: 'Dashboard', icon: Home },
  { href: '/profile' as Route, label: 'Profile', icon: User },
];

export const PROVIDER_NAV_ITEMS: NavItem[] = [
  { href: '/provider' as Route, label: 'Provider Dashboard', icon: LayoutDashboard },
  { href: '/provider/workspace' as Route, label: 'Workspace', icon: Wrench },
  { href: '/bids' as Route, label: 'My Bids', icon: Gavel },
  { href: '/provider/offers' as Route, label: 'Instant Offers', icon: Zap },
  { href: '/provider/team' as Route, label: 'Team', icon: Users },
  { href: '/provider/advances' as Route, label: 'Working Capital', icon: Banknote },
  { href: '/provider/business' as Route, label: 'Business Tools', icon: Building2 },
  { href: '/provider/challenges' as Route, label: 'Challenges', icon: Trophy },
];

// A single entry point into the admin console. The console has its own
// dedicated sidebar (AdminSidebar) for all sub-sections, so surfacing
// Users/Disputes/etc. here too would just duplicate that nav.
export const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: '/admin' as Route, label: 'Admin', icon: Shield },
];

// Ordered by workflow priority, not feature catalogue: the core service-job
// loop first (post → track → contract → message → pay), then the goods/commerce
// loop (browse → orders → sell), then discovery (watchlist/wishlist/searches/
// feed), then account. Previously the discovery features outranked the core
// workflow and Post Job / My Jobs sat dead last — the primary customer action
// was the hardest to find.
export const COMMON_NAV_ITEMS: NavItem[] = [
  // Core services workflow (the primary, original product surface)
  { href: '/jobs/new' as Route, label: 'Post Job', icon: PlusCircle },
  { href: '/jobs' as Route, label: 'Browse Jobs', icon: Search },
  { href: '/jobs/mine' as Route, label: 'My Jobs', icon: Briefcase },
  { href: '/contracts' as Route, label: 'Contracts', icon: FileText },
  { href: '/messages' as Route, label: 'Messages', icon: MessageSquare },
  { href: '/payments' as Route, label: 'Payments', icon: CreditCard },
  // Goods / marketplace workflow
  { href: '/marketplace' as Route, label: 'Marketplace', icon: Gavel },
  { href: '/orders' as Route, label: 'Orders', icon: Package },
  { href: '/sell/new' as Route, label: 'Sell an Item', icon: Tag },
  // Discovery & saved
  { href: '/me/watchlist' as Route, label: 'Watchlist', icon: Heart },
  { href: '/me/wishlist' as Route, label: 'Wishlist', icon: Sparkles },
  { href: '/me/saved-searches' as Route, label: 'Saved Searches', icon: Bookmark },
  { href: '/me/feed' as Route, label: 'My Feed', icon: Rss },
  // Account
  { href: '/settings/security' as Route, label: 'Settings', icon: Settings },
];

// The legal-services vertical is a flag-gated common destination (it used to
// live only in the header). Appended after the common items, before account,
// when the legal_services flag is on.
const LEGAL_NAV_ITEM: NavItem = { href: '/legal' as Route, label: 'Legal', icon: Scale };

// The single active nav href = the MOST-SPECIFIC (longest) item whose path the
// current URL matches exactly or as a sub-path. This prevents a parent like
// "/provider" (Provider Dashboard) from staying highlighted when you're on a
// child tab like "/provider/team" — the child wins.
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname === href || pathname.startsWith(href + '/')) {
      if (best === null || href.length > best.length) best = href;
    }
  }
  return best;
}

/** Build the full ordered nav-item list for the current user's roles, honoring
 *  the working_capital feature flag. Shared by the desktop sidebar and the
 *  dashboard layout's mobile "More" drawer so they never drift. */
export function useNavItems(): NavItem[] {
  const user = useAuthStore((state) => state.user);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const isAdmin = user?.roles.includes(USER_ROLE.ADMIN) ?? false;

  // Working Capital (advances) is gated behind the working_capital flag. When
  // off, drop the nav entry so we don't link to a surface the gateway 503s.
  const workingCapitalEnabled = useFeatureFlag('working_capital');
  const providerNavItems = workingCapitalEnabled
    ? PROVIDER_NAV_ITEMS
    : PROVIDER_NAV_ITEMS.filter((item) => item.href !== '/provider/advances');

  // Legal vertical is flag-gated; when on, slot it in just before Settings (the
  // last common item) so account stays at the bottom.
  const legalEnabled = useFeatureFlag('legal_services');
  const commonItems = legalEnabled
    ? [
        ...COMMON_NAV_ITEMS.slice(0, -1),
        LEGAL_NAV_ITEM,
        COMMON_NAV_ITEMS[COMMON_NAV_ITEMS.length - 1] as NavItem,
      ]
    : COMMON_NAV_ITEMS;

  return [
    ...BASE_NAV_ITEMS,
    ...(isProvider ? providerNavItems : []),
    ...(isAdmin ? ADMIN_NAV_ITEMS : []),
    ...commonItems,
  ];
}

/**
 * The desktop navigation sidebar (the gold-accented `<aside>`). Extracted from
 * the dashboard layout so the marketplace — a PUBLIC route group — can render
 * the exact same nav for authenticated visitors without duplicating markup or
 * pulling in the auth-gated dashboard chrome.
 *
 * Renders nothing for logged-out visitors (and during the auth-restore hydrate
 * window) so the public/logged-out marketplace is untouched: those users see
 * only the shared public Header.
 */
export function SidebarNav() {
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const navItems = useNavItems();

  // Public/logged-out: no sidebar. Also suppress during the hydrate window so
  // we don't flash a sidebar that then disappears if the session fails to
  // restore.
  if (isHydrating || !isAuthenticated) return null;

  // The admin console (/admin/*) renders its OWN dedicated sidebar
  // (AdminSidebar) via the admin layout. Showing this consumer sidebar there
  // too produced two stacked sidebars with overlapping links; suppress it so
  // the admin console is a single, focused nav (with its own "back to app" link).
  if (pathname.startsWith('/admin')) return null;

  const activeHref = activeNavHref(
    pathname,
    navItems.map((i) => i.href),
  );

  return (
    <aside className="glass-sidebar hidden w-64 shrink-0 lg:block">
      <nav className="space-y-1 p-4" aria-label="Primary navigation">
        {navItems.map((item) => {
          const active = item.href === activeHref;
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
  );
}
