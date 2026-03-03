'use client';

import { ShieldAlert } from 'lucide-react';

import { AdminSidebar } from '@/components/admin/AdminSidebar';
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
        <p className="text-muted-foreground">
          You do not have permission to access the admin dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-0">
      <aside className="hidden w-56 shrink-0 border-r lg:block">
        <div className="sticky top-0 p-4">
          <h2 className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Admin Panel
          </h2>
          <AdminSidebar />
        </div>
      </aside>
      <div className="min-w-0 flex-1 p-6">{children}</div>
    </div>
  );
}
