'use client';

import { ArrowLeft, ShieldAlert } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { PaymentsReadinessBanner } from '@/components/admin/PaymentsReadinessBanner';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.roles.includes(USER_ROLE.ADMIN) ?? false;

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <ShieldAlert className="h-12 w-12 text-destructive" aria-hidden="true" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-zinc-300">
          You do not have permission to access the admin dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 gap-0">
      <aside className="hidden w-56 shrink-0 border-r border-white/[0.06] lg:block">
        <div className="sticky top-0 p-4">
          {/* Back to the consumer app — the admin console replaces the main
              sidebar, so this is the way out. */}
          <Link
            href={'/dashboard' as Route}
            className="mb-3 flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/40"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to app
          </Link>
          <h2 className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--brand-gold)]">
            Admin Panel
          </h2>
          <AdminSidebar />
        </div>
      </aside>
      <div className="min-w-0 flex-1 space-y-4 p-6">
        <PaymentsReadinessBanner />
        {children}
      </div>
    </div>
  );
}
