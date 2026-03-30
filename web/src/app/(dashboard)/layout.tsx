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
  MessageSquare,
  PlusCircle,
  Shield,
  User,
  Users,
  Zap,
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
  { href: '/provider/team' as Route, label: 'Team', icon: Users },
  { href: '/provider/advances' as Route, label: 'Working Capital', icon: Banknote },
  { href: '/provider/business' as Route, label: 'Business Tools', icon: Building2 },
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
  if (href === '/dashboard' || href === '/bids' || href === '/jobs/mine' || href === '/jobs/new' || href === '/provider/advances' || href === '/provider/business' || href === '/provider/team') {
    return pathname === href || pathname.startsWith(href + '/');
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
      <div className="dark flex min-h-screen flex-col bg-[#070b14]">
        <Header />

        {/* Mobile nav bar - vivid dark terminal treatment */}
        <nav
          className="glass-nav flex overflow-x-auto px-2 py-1 lg:hidden"
          aria-label="Dashboard navigation (mobile)"
        >
          {allNavItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex min-h-[44px] min-w-[44px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1 text-[0.625rem] font-medium transition-colors duration-200',
                  active
                    ? 'bg-[var(--brand-gold)]/10 text-[var(--brand-gold)]'
                    : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200',
                )}
              >
                <item.icon className="h-5 w-5" aria-hidden="true" />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
          <Link
            href={'/demo/auction' as Route}
            className="flex min-h-[44px] min-w-[44px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1 text-[0.625rem] font-semibold text-amber-400 transition-colors duration-200 hover:bg-amber-500/10 hover:text-amber-300"
          >
            <Zap className="h-5 w-5" aria-hidden="true" />
            <span className="whitespace-nowrap">Live Demo</span>
          </Link>
        </nav>

        <div className="flex flex-1">
          {/* Sidebar - dark terminal panel with gold accent */}
          <aside className="glass-sidebar hidden w-64 lg:block">
            <nav className="space-y-1 p-4" aria-label="Dashboard navigation">
              {allNavItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                      active
                        ? 'bg-[var(--brand-gold)]/10 text-[var(--brand-gold)] shadow-[inset_0_1px_0_rgba(201,168,76,0.1)]'
                        : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200',
                    )}
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
              <div className="my-2 border-t border-[var(--brand-gold)]/10" />
              <Link
                href={'/demo/auction' as Route}
                className="relative flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-amber-400 transition-all duration-200 hover:bg-amber-500/10 hover:text-amber-300"
              >
                <Zap className="h-4 w-4" aria-hidden="true" />
                Live Demo
              </Link>
            </nav>
          </aside>
          <WebSocketProvider>
            {/* Main content area with vivid dark ambient background */}
            <main className="dashboard-ambient flex-1 p-6">{children}</main>
          </WebSocketProvider>
        </div>
      </div>
    </AuthGuard>
  );
}
