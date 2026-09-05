'use client';

import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Briefcase,
  Building2,
  CreditCard,
  FileCheck,
  Flag,
  Landmark,
  LayoutDashboard,
  LineChart,
  MapPin,
  MessageSquareWarning,
  Network,
  Package,
  Scale,
  Shield,
  ShieldCheck,
  ShoppingBag,
  ToggleRight,
  Trophy,
  Umbrella,
  Users,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { cn } from '@/lib/utils';

interface AdminNavItem {
  href: Route;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * Optional feature-flag key gating this entry. When set, the item is hidden
   * only when the backend explicitly reports the flag as `false`. A missing
   * key (flag not configured) fails open — the entry stays visible — so this
   * never breaks if the flag hasn't been seeded yet.
   */
  flag?: string;
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: '/admin' as Route, label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/users' as Route, label: 'Users', icon: Users },
  { href: '/admin/verification' as Route, label: 'Verification', icon: FileCheck },
  { href: '/admin/jobs' as Route, label: 'Jobs', icon: BarChart3 },
  { href: '/admin/listings' as Route, label: 'Listings', icon: ShoppingBag },
  { href: '/admin/markets' as Route, label: 'Markets', icon: MapPin },
  { href: '/admin/goods-reports' as Route, label: 'Goods Reports', icon: Package },
  { href: '/admin/job-reports' as Route, label: 'Job Reports', icon: Briefcase },
  { href: '/admin/user-reports' as Route, label: 'User Reports', icon: MessageSquareWarning },
  { href: '/admin/disputes' as Route, label: 'Disputes', icon: AlertTriangle },
  { href: '/admin/reviews' as Route, label: 'Reviews', icon: Flag },
  { href: '/admin/fraud' as Route, label: 'Fraud', icon: Shield },
  { href: '/admin/payments' as Route, label: 'Payments', icon: CreditCard },
  { href: '/admin/banking' as Route, label: 'Banking', icon: Landmark },
  { href: '/admin/advances' as Route, label: 'Advances', icon: Banknote },
  { href: '/admin/guarantee' as Route, label: 'Guarantee', icon: ShieldCheck },
  { href: '/admin/insurance' as Route, label: 'Insurance', icon: Umbrella },
  {
    href: '/admin/insurers' as Route,
    label: 'Insurers',
    icon: Building2,
    flag: 'insurance_competition',
  },
  {
    href: '/admin/licenses' as Route,
    label: 'Licenses',
    icon: Scale,
    flag: 'legal_services',
  },
  { href: '/admin/taxonomy' as Route, label: 'Taxonomy', icon: Network },
  { href: '/admin/challenges' as Route, label: 'Challenges', icon: Trophy },
  { href: '/admin/flags' as Route, label: 'Feature Flags', icon: ToggleRight },
  { href: '/admin/platform' as Route, label: 'Platform', icon: LineChart },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname.startsWith(href);
}

export function AdminSidebar() {
  const pathname = usePathname();
  const flags = useFeatureFlags();

  // Hide a flagged entry only when the backend explicitly reports `false`;
  // missing/loading flags fail open so a new surface never silently disappears.
  const navItems = ADMIN_NAV_ITEMS.filter(
    (item) => item.flag === undefined || flags[item.flag] !== false,
  );

  return (
    <nav className="space-y-1" aria-label="Admin navigation">
      {navItems.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
