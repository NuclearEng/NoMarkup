'use client';

import { Briefcase, CreditCard, FileText, Gavel, Home, LayoutDashboard, PlusCircle, User } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

interface NavItem {
  href: Route;
  label: string;
  icon: typeof Home;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard' as Route, label: 'Dashboard', icon: Home },
  { href: '/profile' as Route, label: 'Profile', icon: User },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 border-r lg:block">
        <nav className="space-y-1 p-4" aria-label="Dashboard navigation">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                pathname === item.href
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </Link>
          ))}

          {isProvider ? (
            <>
              <Link
                href={'/provider' as Route}
                className={cn(
                  'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                  pathname.startsWith('/provider')
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                Provider Dashboard
              </Link>
              <Link
                href={'/bids' as Route}
                className={cn(
                  'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                  pathname === '/bids'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Gavel className="h-4 w-4" aria-hidden="true" />
                My Bids
              </Link>
            </>
          ) : null}

          <Link
            href={'/contracts' as Route}
            className={cn(
              'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
              pathname.startsWith('/contracts')
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Contracts
          </Link>

          <Link
            href={'/payments' as Route}
            className={cn(
              'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
              pathname.startsWith('/payments')
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Payments
          </Link>

          <Link
            href={'/jobs/mine' as Route}
            className={cn(
              'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
              pathname === '/jobs/mine'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Briefcase className="h-4 w-4" aria-hidden="true" />
            My Jobs
          </Link>

          <Link
            href={'/jobs/new' as Route}
            className={cn(
              'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
              pathname === '/jobs/new'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            Post Job
          </Link>
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
