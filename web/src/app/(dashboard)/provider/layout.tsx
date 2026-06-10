'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
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

  return <div>{children}</div>;
}
