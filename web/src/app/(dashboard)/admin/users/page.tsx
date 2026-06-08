'use client';

import { useState } from 'react';

import type { Route } from 'next';
import Link from 'next/link';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAdminUsers, useBanUser, useSuspendUser } from '@/hooks/useAdmin';
import { USER_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn } from '@/lib/utils';
import type { AdminUser } from '@/types';
import { USER_ROLE, USER_STATUS } from '@/types';

const ALL_FILTER = '__all__';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [actionTarget, setActionTarget] = useState<{
    user: AdminUser;
    action: 'suspend' | 'ban';
  } | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, isError } = useAdminUsers({
    query: query || undefined,
    status: statusFilter,
    role: roleFilter,
    page,
    page_size: 20,
  });

  const suspendMutation = useSuspendUser();
  const banMutation = useBanUser();

  function handleSearch(e: React.SyntheticEvent) {
    e.preventDefault();
    setPage(1);
  }

  async function handleConfirmAction() {
    if (!actionTarget) return;
    const mutation = actionTarget.action === 'suspend' ? suspendMutation : banMutation;
    await mutation.mutateAsync({
      userId: actionTarget.user.id,
      reason,
    });
    setActionTarget(null);
    setReason('');
  }

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (user) => (
        <Link
          href={`/admin/users/${user.id}` as Route}
          className="text-primary -my-2 -mx-2 inline-flex min-h-[44px] items-center px-2 py-2 font-medium hover:underline"
        >
          {user.display_name || user.email}
        </Link>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      render: (user) => (
        <span
          className="block max-w-[16rem] truncate text-zinc-300"
          title={user.email}
        >
          {user.email}
        </span>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (user) => (
        <div className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <Badge key={role} variant="outline" className="text-xs capitalize">
              {role}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (user) => (
        <Badge variant="outline" className={cn('text-xs capitalize', USER_STATUS_CLASSES[user.status])}>
          {user.status}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Joined',
      render: (user) => (
        <span className="text-zinc-300">{formatDate(user.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right whitespace-nowrap',
      render: (user) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            disabled={user.status === USER_STATUS.SUSPENDED}
            onClick={(e) => {
              e.stopPropagation();
              setActionTarget({ user, action: 'suspend' });
            }}
            aria-label={`Suspend ${user.first_name ?? ''} ${user.last_name ?? ''}`}
          >
            Suspend
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="min-h-[44px]"
            disabled={user.status === USER_STATUS.BANNED}
            onClick={(e) => {
              e.stopPropagation();
              setActionTarget({ user, action: 'ban' });
            }}
            aria-label={`Ban ${user.first_name ?? ''} ${user.last_name ?? ''}`}
          >
            Ban
          </Button>
        </div>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="gold-text text-2xl font-bold tracking-tight">User Management</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load users"
          description="Please try refreshing the page."
        />
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">User Management</h1>
        <p className="text-zinc-300 mt-1">Search, view, and manage platform users.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <form onSubmit={handleSearch} className="flex-1">
          <Input
            placeholder="Search by name or email..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className="min-h-[44px]"
            aria-label="Search users"
          />
        </form>

        <div className="flex items-center gap-2">
          <span className="text-zinc-300 text-sm font-medium">Status:</span>
          <Select
            value={statusFilter ?? ALL_FILTER}
            onValueChange={(v) => {
              setStatusFilter(v === ALL_FILTER ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="min-h-[44px] w-[150px]" aria-label="Filter by status">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All</SelectItem>
              {Object.entries(USER_STATUS).map(([key, value]) => (
                <SelectItem key={key} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-zinc-300 text-sm font-medium">Role:</span>
          <Select
            value={roleFilter ?? ALL_FILTER}
            onValueChange={(v) => {
              setRoleFilter(v === ALL_FILTER ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="min-h-[44px] w-[150px]" aria-label="Filter by role">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All</SelectItem>
              {Object.entries(USER_ROLE).map(([key, value]) => (
                <SelectItem key={key} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.users ?? []}
        rowKey={(user) => user.id}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        loading={isLoading}
        emptyMessage="No users found matching the current filters."
      />

      <ActionConfirmDialog
        open={actionTarget !== null}
        onClose={() => {
          setActionTarget(null);
          setReason('');
        }}
        onConfirm={() => {
          void handleConfirmAction();
        }}
        title={
          actionTarget?.action === 'ban'
            ? `Ban ${actionTarget.user.display_name || actionTarget.user.email}`
            : `Suspend ${actionTarget?.user.display_name || actionTarget?.user.email || ''}`
        }
        description={
          actionTarget?.action === 'ban'
            ? 'This will permanently ban the user from the platform. This action is hard to reverse.'
            : 'This will temporarily suspend the user. They will not be able to use the platform until unsuspended.'
        }
        confirmLabel={actionTarget?.action === 'ban' ? 'Ban User' : 'Suspend User'}
        destructive
        loading={suspendMutation.isPending || banMutation.isPending}
        confirmDisabled={!reason.trim()}
      >
        <div className="space-y-2">
          <label htmlFor="action-reason" className="text-sm font-medium">
            Reason
          </label>
          <Textarea
            id="action-reason"
            placeholder="Provide a reason for this action..."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            rows={3}
          />
        </div>
      </ActionConfirmDialog>
    </div>
    </PageTransition>
  );
}
