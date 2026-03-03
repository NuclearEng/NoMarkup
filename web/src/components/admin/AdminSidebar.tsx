'use client';

import {
  AlertTriangle,
  BarChart3,
  CreditCard,
  FileCheck,
  Flag,
  LayoutDashboard,
  MessageSquareWarning,
  Shield,
  Users,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface AdminNavItem {
  href: Route;
  label: string;
  icon: typeof LayoutDashboard;
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: '/admin' as Route, label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/users' as Route, label: 'Users', icon: Users },
  { href: '/admin/verification' as Route, label: 'Verification', icon: FileCheck },
  { href: '/admin/jobs' as Route, label: 'Jobs', icon: BarChart3 },
  { href: '/admin/disputes' as Route, label: 'Disputes', icon: AlertTriangle },
  { href: '/admin/reviews' as Route, label: 'Reviews', icon: Flag },
  { href: '/admin/fraud' as Route, label: 'Fraud', icon: Shield },
  { href: '/admin/payments' as Route, label: 'Payments', icon: CreditCard },
  { href: '/admin/platform' as Route, label: 'Platform', icon: MessageSquareWarning },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname.startsWith(href);
}

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1" aria-label="Admin navigation">
      {ADMIN_NAV_ITEMS.map((item) => {
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
