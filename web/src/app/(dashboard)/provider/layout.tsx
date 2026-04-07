'use client';

import { Zap } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

function ProviderNav() {
  const pathname = usePathname();

  const navItems = [{ href: '/provider/offers', label: 'Instant Offers', icon: Zap }];

  return (
    <nav
      aria-label="Provider navigation"
      className="border-border/40 mb-6 flex gap-1 overflow-x-auto border-b pb-4"
    >
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            className={`flex min-h-[36px] items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              isActive
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted/50 text-zinc-400 hover:text-zinc-200'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function ProviderLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;

  if (isHydrating) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    );
  }

  if (!isProvider) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
          Provider Access Required
        </h1>
        <p className="text-zinc-300">
          You need a provider account to access this section. Upgrade your account from your profile
          page.
        </p>
        <div className="flex justify-center gap-3">
          <Button asChild className="min-h-[44px]">
            <Link href="/profile">Go to Profile</Link>
          </Button>
          <Button variant="outline" asChild className="min-h-[44px]">
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ProviderNav />
      {children}
    </div>
  );
}
