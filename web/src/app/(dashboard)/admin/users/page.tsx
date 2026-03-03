'use client';

import { useState } from 'react';

import type { Route } from 'next';
import Link from 'next/link';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAdminUsers, useBanUser, useSuspendUser } from '@/hooks/useAdmin';
import { cn } from '@/lib/utils';
import type { AdminUser, UserStatus } from '@/types';
import { USER_ROLE, USER_STATUS } from '@/types';

const ALL_FILTER = '__all__';

const STATUS_CLASSES: Record<UserStatus, string> = {
  active: 'bg-green-100 text-green-800 border-green-200',
  suspended: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  banned: 'bg-red-100 text-red-800 border-red-200',
  deactivated: 'bg-gray-100 text-gray-800 border-gray-200',
};

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
    const mutation =
      actionTarget.action === 'suspend' ? suspendMutation : banMutation;
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
          className="font-medium text-primary hover:underline"
        >
          {user.first_name} {user.last_name}
        </Link>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      render: (user) => (
        <span className="text-muted-foreground">{user.email}</span>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (user) => (
        <div className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <Badge key={role} variant="outline" className="text-xs">
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
        <Badge
          variant="outline"
          className={cn('text-xs', STATUS_CLASSES[user.status])}
        >
          {user.status}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Joined',
      render: (user) => (
        <span className="text-muted-foreground">{formatDate(user.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
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
            aria-label={`Suspend ${user.first_name} ${user.last_name}`}
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
            aria-label={`Ban ${user.first_name} ${user.last_name}`}
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
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load users. Please try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <p className="mt-1 text-muted-foreground">
          Search, view, and manage platform users.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <form onSubmit={handleSearch} className="flex-1">
          <Input
            placeholder="Search by name or email..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            className="min-h-[44px]"
            aria-label="Search users"
          />
        </form>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Status:</span>
          <Select
            value={statusFilter ?? ALL_FILTER}
            onValueChange={(v) => {
              setStatusFilter(v === ALL_FILTER ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[150px] min-h-[44px]" aria-label="Filter by status">
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
          <span className="text-sm font-medium text-muted-foreground">Role:</span>
          <Select
            value={roleFilter ?? ALL_FILTER}
            onValueChange={(v) => {
              setRoleFilter(v === ALL_FILTER ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[150px] min-h-[44px]" aria-label="Filter by role">
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
        onConfirm={() => { void handleConfirmAction(); }}
        title={
          actionTarget?.action === 'ban'
            ? `Ban ${actionTarget.user.first_name} ${actionTarget.user.last_name}`
            : `Suspend ${actionTarget?.user.first_name ?? ''} ${actionTarget?.user.last_name ?? ''}`
        }
        description={
          actionTarget?.action === 'ban'
            ? 'This will permanently ban the user from the platform. This action is hard to reverse.'
            : 'This will temporarily suspend the user. They will not be able to use the platform until unsuspended.'
        }
        confirmLabel={actionTarget?.action === 'ban' ? 'Ban User' : 'Suspend User'}
        destructive
        loading={suspendMutation.isPending || banMutation.isPending}
      >
        <div className="space-y-2">
          <label
            htmlFor="action-reason"
            className="text-sm font-medium"
          >
            Reason
          </label>
          <Textarea
            id="action-reason"
            placeholder="Provide a reason for this action..."
            value={reason}
            onChange={(e) => { setReason(e.target.value); }}
            rows={3}
          />
        </div>
      </ActionConfirmDialog>
    </div>
  );
}
