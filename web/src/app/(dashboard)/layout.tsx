'use client';

import {
  BarChart3,
  Briefcase,
  CreditCard,
  FileText,
  Gavel,
  Home,
  LayoutDashboard,
  MessageSquare,
  PlusCircle,
  Shield,
  User,
  Users,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Header } from '@/components/layout/Header';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { WebSocketProvider } from '@/components/providers/WebSocketProvider';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

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
  { href: '/bids' as Route, label: 'My Bids', icon: Gavel },
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
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard' || href === '/bids' || href === '/jobs/mine' || href === '/jobs/new') {
    return pathname === href;
  }
  return pathname.startsWith(href);
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const isAdmin = user?.roles.includes(USER_ROLE.ADMIN) ?? false;

  const allNavItems = [
    ...BASE_NAV_ITEMS,
    ...(isProvider ? PROVIDER_NAV_ITEMS : []),
    ...(isAdmin ? ADMIN_NAV_ITEMS : []),
    ...COMMON_NAV_ITEMS,
  ];

  return (
    <AuthGuard>
      <div className="flex min-h-screen flex-col">
        <Header />

        {/* Mobile nav bar - shown below header on small screens */}
        <nav
          className="flex overflow-x-auto border-b px-2 py-1 lg:hidden"
          aria-label="Dashboard navigation (mobile)"
        >
          {allNavItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex min-h-[44px] min-w-[44px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-3 py-1 text-[0.625rem] font-medium',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <item.icon className="h-5 w-5" aria-hidden="true" />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-1">
          <aside className="hidden w-64 border-r lg:block">
            <nav className="space-y-1 p-4" aria-label="Dashboard navigation">
              {allNavItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
          <WebSocketProvider>
            <main className="flex-1 p-6">{children}</main>
          </WebSocketProvider>
        </div>
      </div>
    </AuthGuard>
  );
}
