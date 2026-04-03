'use client';

import { Bell, CreditCard, Crown, Shield } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const SETTINGS_NAV = [
  { href: '/settings/security' as Route, label: 'Security', icon: Shield },
  { href: '/settings/notifications' as Route, label: 'Notifications', icon: Bell },
  { href: '/settings/payment-methods' as Route, label: 'Payment Methods', icon: CreditCard },
  { href: '/settings/subscription' as Route, label: 'Subscription', icon: Crown },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-zinc-400">Manage your account preferences.</p>
      </div>

      {/* Settings tab navigation */}
      <nav
        className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--brand-gold)]/10 bg-white/[0.03] p-1"
        aria-label="Settings"
      >
        {SETTINGS_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex min-h-[44px] items-center gap-2 rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                active
                  ? 'bg-[var(--brand-gold)]/10 text-[var(--brand-gold)]'
                  : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Settings content */}
      <div>{children}</div>
    </div>
  );
}
