'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

// Provider section nav (Dashboard, Workspace, My Bids, Instant Offers, Team, …)
// lives in the main sidebar's provider group — no separate in-page tab bar.
export default function ProviderLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;

  if (isHydrating) {
    return (
      <div
        className="space-y-6"
        role="status"
        aria-live="polite"
        aria-label="Loading provider section"
      >
        <div>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={`provider-layout-stat-${String(i)}`}
              className="h-28 rounded-xl"
            />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <Skeleton className="h-44 rounded-xl" />
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

  return <div>{children}</div>;
}
